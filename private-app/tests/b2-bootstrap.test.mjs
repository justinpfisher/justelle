import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,mkdir,symlink,writeFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {EventEmitter} from 'node:events';
import {bootstrap,capabilities,parseCreatedKey,verifyKeyList,validateEndpoint,
  readOfflineRecoveryKey,selectBootstrapTarget,windowsCliInvocation} from '../tools/bootstrap-b2-secret.mjs';
import {decodePrintedRecoveryKey,readPaperRecoveryKey} from '../memory/paper-recovery-key.mjs';

const endpoint='https://s3.us-west-004.backblazeb2.com';
const keyId='testappkeyid12345';
const appKey='SYNTHETIC_not-real-secret/12345';
const capString=capabilities.join(',');
const listLine=()=>keyId+" justelle-qualification-backup justelle-qualification-backups - - 'qualification/' "+capString;
function makeRunner({preexistingKey=false,preexistingVersion=false,scopeMismatch=false,failAt='',failDelete=false}={}){
  const calls=[];let created=false,installed=null;
  async function run(provider,args,stdin){
    const command=provider+' '+args.join(' ');
    calls.push({provider,args,stdin:stdin?Buffer.from(stdin):null});
    if(failAt&&command.includes(failAt)&&!(provider==='b2'&&args[1]==='delete'))throw Error('Simulated sensitive failure');
    if(provider==='b2'&&args[0]==='key'&&args[1]==='list')
      return (preexistingKey||created?listLine().replace(scopeMismatch?"'qualification/'":"no-match","'wrong/'"): '')+'\n';
    if(provider==='b2'&&args[0]==='key'&&args[1]==='create'){
      created=true;return Buffer.from(keyId+' '+appKey+'\n');
    }
    if(provider==='b2'&&args[0]==='key'&&args[1]==='delete'){
      if(failDelete)throw Error('Cannot revoke');
      created=false;return '';
    }
    if(provider==='gcloud'&&args[0]==='secrets'&&args[1]==='list')return '[]';
    if(provider==='gcloud'&&args[0]==='secrets'&&args[1]==='create')return '';
    if(provider==='gcloud'&&args[0]==='secrets'&&args[1]==='versions'&&args[2]==='list')
      return preexistingVersion?'[{"name":"projects/123/secrets/JUSTELLE_BACKUP_CONFIG/versions/1"}]':'[]';
    if(provider==='gcloud'&&args[0]==='secrets'&&args[1]==='versions'&&args[2]==='add'){
      installed=JSON.parse(stdin.toString('utf8'));return '';
    }
    throw Error('Unexpected synthetic command '+command);
  }
  return {run,calls,get installed(){return installed;}};
}
const runBootstrap=async (runner,options={})=>bootstrap({endpoint,recoveryKey:Buffer.alloc(32,17),offlineCustodyConfirmed:true,run:runner.run,...options});

test('Windows launcher invokes the installed B2 v5 Python module without requiring b2.exe',()=>{
  const b2=windowsCliInvocation('b2',['key','list']);
  assert.deepEqual(b2,{binary:'py',args:['-m','b2._internal.b2v5','key','list']});
  const create=windowsCliInvocation('b2',['key','create','--bucket','test-private-bucket',
    '--name-prefix','qualification/','test-restricted-key',capString]);
  assert.equal(create.binary,'py');
  assert.deepEqual(create.args.slice(0,3),['-m','b2._internal.b2v5','key']);
  assert.equal(create.args.includes('--bucket'),true);
  assert.equal(create.args.includes('test-private-bucket'),true);
  // The local pip install may not have generated an executable in its Scripts path.
  // Our invocation must not depend on APPDATA, PATH changes or PowerShell policy.
  const gcloud=windowsCliInvocation('gcloud',
    ['secrets','list','--project=justelle-qualification','--quiet'],
    {comSpec:'C:\\Windows\\System32\\cmd.exe'});
  assert.equal(gcloud.binary,'C:\\Windows\\System32\\cmd.exe');
  assert.deepEqual(gcloud.args,
    ['/d','/s','/c','gcloud.cmd secrets list --project=justelle-qualification --quiet']);
  assert.throws(()=>windowsCliInvocation('unknown',[]),/Unsupported private command/);
});

test('validates exact B2 HTTPS endpoint and rejects credentials/unexpected hosts',()=>{
  assert.equal(validateEndpoint(endpoint),endpoint);
  for(const host of ['http://s3.us-west-004.backblazeb2.com','https://s3.fake.com',
    'https://user:pass@s3.us-west-004.backblazeb2.com','https://s3.us-west-004.backblazeb2.com/bucket',
    'https://s3.us-west-004.backblazeb2.com?token=x'])
    assert.throws(()=>validateEndpoint(host),/Invalid Backblaze S3 endpoint/);
});

test('B2 key parser accepts only a single private two-token response',()=>{
  assert.deepEqual(parseCreatedKey(keyId+' '+appKey),{keyId,applicationKey:appKey});
  assert.throws(()=>parseCreatedKey('log line\n'+keyId+' '+appKey),/unexpected key format/);
  assert.throws(()=>parseCreatedKey('onlyone'),/unexpected key format/);
});

test('B2 key-list metadata enforces bucket, prefix, and exactly five capabilities',()=>{
  assert.equal(verifyKeyList(listLine(),keyId),true);
  assert.throws(()=>verifyKeyList(listLine().replace("'qualification/'","'elsewhere/'"),keyId),/restrictions/);
  assert.throws(()=>verifyKeyList(listLine().replace('readFiles','deleteFiles'),keyId),/restrictions/);
});

test('successful one-time bootstrap never writes key material to output/command args',async()=>{
  const runner=makeRunner();const result=await runBootstrap(runner);
  assert.deepEqual(result,{restricted_key_installed:true,secret_version_added:true,offline_custody_owner_confirmed:true});
  const json=runner.installed;
  assert.equal(json.endpoint,endpoint);
  assert.equal(json.bucket,'justelle-qualification-backups');
  assert.equal(json.prefix,'qualification');
  assert.equal(json.applicationKey,appKey);
  assert.equal(json.keyId,keyId);
  assert.equal(Buffer.from(json.recoveryKeyBase64,'base64').length,32);
  assert.equal(runner.calls.filter(c=>c.provider==='b2'&&c.args[1]==='create').length,1);
  assert.equal(runner.calls.filter(c=>c.provider==='gcloud'&&c.args[2]==='add').length,1);
  assert.equal(runner.calls.filter(c=>c.provider==='b2'&&c.args[1]==='delete').length,0);
  for(const c of runner.calls){
    assert.ok(!c.args.join(' ').includes(appKey));
    assert.ok(!c.args.join(' ').includes(json.recoveryKeyBase64));
    if(c.stdin)assert.equal(c.provider,'gcloud');
  }
});

test('refuses issuance when key already exists or backup secret already has a version',async()=>{
  for(const settings of [{preexistingKey:true},{preexistingVersion:true}]){
    const runner=makeRunner(settings);
    await assert.rejects(runBootstrap(runner),/failed closed/);
    assert.equal(runner.calls.some(c=>c.provider==='b2'&&c.args[1]==='create'),false);
  }
});

test('requires verified owner offline custody before any provider calls',async()=>{
  const runner=makeRunner();
  await assert.rejects(runBootstrap(runner,{offlineCustodyConfirmed:false}),/Owner-confirmed/);
  assert.equal(runner.calls.length,0);
});

test('revokes new key if scope check or Secret Manager installation fails; errors redact secrets',async()=>{
  for(const settings of [{scopeMismatch:true},{failAt:'versions add'}]){
    const runner=makeRunner(settings);
    let message='';
    try{await runBootstrap(runner);}catch(e){message=e.message;}
    assert.match(message,/failed closed/);
    assert.ok(!message.includes(appKey));
    assert.ok(runner.calls.some(c=>c.provider==='b2'&&c.args[1]==='delete'));
    assert.equal(runner.calls.some(c=>c.provider==='b2'&&c.args[1]==='create'),true);
  }
});

test('a failed key revocation is reported, still without exposing the key',async()=>{
  const runner=makeRunner({failAt:'versions add',failDelete:true});
  await assert.rejects(runBootstrap(runner),e=>{
    assert.match(e.message,/revocation failed/);
    assert.ok(!e.message.includes(appKey));
    return true;
  });
});

test('offline recovery file must have 32 bytes and remain outside repository/OneDrive',async()=>{
  const root=await mkdtemp(join(tmpdir(),'justelle-test-repo-'));
  const outside=await mkdtemp(join(tmpdir(),'justelle-test-offline-'));
  try{
    const ok=join(outside,'key.bin');const bad=join(outside,'bad.bin');
    await writeFile(ok,Buffer.alloc(32,2));await writeFile(bad,Buffer.alloc(8,2));
    const key=await readOfflineRecoveryKey(ok,root);
    assert.equal(key.length,32);key.fill(0);
    await assert.rejects(readOfflineRecoveryKey(bad,root),/32-byte/);
    const inRepo=join(root,'key.bin');await writeFile(inRepo,Buffer.alloc(32,1));
    await assert.rejects(readOfflineRecoveryKey(inRepo,root),/outside the repository/);
    await mkdir(join(outside,'OneDrive'));
    const inSync=join(outside,'OneDrive','key.bin');await writeFile(inSync,Buffer.alloc(32,3));
    await assert.rejects(readOfflineRecoveryKey(inSync,root),/OneDrive/);
    // Also refuse Windows' labelled OneDrive sync roots.
    for(const folderName of ['OneDrive - Example','OneDrive – Family']){
      const labelled=join(outside,folderName);
      await mkdir(labelled);
      const file=join(labelled,'key.bin');
      await writeFile(file,Buffer.alloc(32,5));
      await assert.rejects(readOfflineRecoveryKey(file,root),/OneDrive/);
    }
    const link=join(outside,'link.bin');
    try{await symlink(ok,link);await assert.rejects(readOfflineRecoveryKey(link,root),/regular file/);}catch(e){if(e.code!=='EPERM'&&e.code!=='EACCES')throw e;}
  }finally{await rm(root,{recursive:true,force:true});await rm(outside,{recursive:true,force:true});}
});


test('paper recovery encoding accepts exact random bytes as grouped hex or canonical Base64',()=>{
  const bytes=Buffer.from(Array.from({length:32},(_,i)=>i+1));
  const hex=bytes.toString('hex');
  const grouped=hex.match(/.{1,8}/g).join('-');
  assert.deepEqual(decodePrintedRecoveryKey(hex),bytes);
  assert.deepEqual(decodePrintedRecoveryKey(grouped),bytes);
  assert.deepEqual(decodePrintedRecoveryKey(bytes.toString('base64')),bytes);
  for(const invalid of ['a'.repeat(63),'z'.repeat(64),'password123',
    'a'.repeat(44),bytes.toString('base64').replace(/=$/,'A')]){
    assert.throws(()=>decodePrintedRecoveryKey(invalid),/Printed recovery key/);
  }
});
class SimulatedTTY extends EventEmitter{
  constructor(){super();this.isTTY=true;this.isRaw=false;this.paused=false;}
  setRawMode(value){this.isRaw=value;}
  resume(){this.paused=false;}
  pause(){this.paused=true;}
}
function mockPrivateConsole(){
  const input=new SimulatedTTY();
  const output={isTTY:true,text:'',write(value){this.text+=value;}};
  return {input,output};
}
const tick=()=>new Promise(resolve=>setImmediate(resolve));
test('paper key is entered twice without echo, shell history, temporary file or normal output',async()=>{
  const {input,output}=mockPrivateConsole();
  const key=Buffer.alloc(32,9).toString('hex');
  const reading=readPaperRecoveryKey({input,output});
  assert.equal(input.isRaw,true);
  input.emit('data',Buffer.from(key.slice(0,20)));
  input.emit('data',Buffer.from(key.slice(20)+'\r'));
  await tick();
  input.emit('data',Buffer.from(key+'\r'));
  const received=await reading;
  assert.equal(received.toString('hex'),key);
  assert.equal(input.isRaw,false);
  assert.equal(input.paused,true);
  assert.ok(!output.text.includes(key));
  assert.match(output.text,/input hidden/);
  received.fill(0);
});
test('paper input mismatches and cancellation fail closed and restore TTY mode',async()=>{
  const key=Buffer.alloc(32,7).toString('hex');
  for(const second of [Buffer.alloc(32,8).toString('hex'),'\x03']){
    const {input,output}=mockPrivateConsole();
    const reading=readPaperRecoveryKey({input,output});
    input.emit('data',Buffer.from(key+'\n'));
    await tick();
    input.emit('data',Buffer.from(second+(second==='\x03'?'':'\n')));
    await assert.rejects(reading,/do not match|cancelled/);
    assert.equal(input.isRaw,false);
    assert.ok(!output.text.includes(key));
  }
});
test('paper input is refused when a private TTY is unavailable',async()=>{
  await assert.rejects(readPaperRecoveryKey({input:{isTTY:false},output:{isTTY:false}}),/interactive terminal/);
});

test('production bootstrap rejects cross-environment buckets and requires an explicit target',()=>{
  const productionBucket='justelle-production-backups-v1x';
  const target=selectBootstrapTarget('production',productionBucket);
  assert.deepEqual(target,{project:'justelle-production',bucket:productionBucket,
    prefix:'production/',keyName:'justelle-production-backup'});
  assert.equal(selectBootstrapTarget().project,'justelle-qualification');
  assert.equal(selectBootstrapTarget('qualification','justelle-qualification-backups-alt3').bucket,
    'justelle-qualification-backups-alt3');
  for(const [mode,bucketName] of [
    ['production',undefined],['production','justelle-qualification-backups'],
    ['production','other-project-backups'],['production','justelle-production-backups/other'],
    ['qualification',productionBucket],['other',productionBucket]
  ])assert.throws(()=>selectBootstrapTarget(mode,bucketName),/bucket|environment/i);
  const productionLine=keyId+' '+target.keyName+' '+productionBucket+" - - 'production/' "+capString;
  assert.equal(verifyKeyList(productionLine,keyId,target),true);
  assert.throws(()=>verifyKeyList(listLine(),keyId,target),/restrictions/);
});

test('production bootstrap keeps its key, prefix, Secret Manager project and credentials isolated',async()=>{
  const bucketName='justelle-production-backups-v1x';
  const expected=selectBootstrapTarget('production',bucketName);
  const calls=[];let created=false,installed;
  async function run(provider,args,stdin){
    calls.push({provider,args});
    if(provider==='b2'&&args[0]==='key'&&args[1]==='list')
      return created?
        keyId+' '+expected.keyName+' '+expected.bucket+" - - 'production/' "+capString+'\n':'';
    if(provider==='b2'&&args[0]==='key'&&args[1]==='create'){
      assert.deepEqual(args,['key','create','--bucket',bucketName,'--name-prefix','production/',
        'justelle-production-backup',capString]);
      created=true;return Buffer.from(keyId+' '+appKey+'\n');
    }
    if(provider==='gcloud'){
      assert.ok(args.includes('--project=justelle-production'));
      if(args[0]==='secrets'&&args[1]==='list')return '[]';
      if(args[0]==='secrets'&&args[1]==='create')return '';
      if(args[0]==='secrets'&&args[1]==='versions'&&args[2]==='list')return '[]';
      if(args[0]==='secrets'&&args[1]==='versions'&&args[2]==='add'){
        installed=JSON.parse(stdin.toString('utf8'));return '';
      }
    }
    throw Error('Unexpected synthetic production command');
  }
  const result=await bootstrap({endpoint,recoveryKey:Buffer.alloc(32,25),
    offlineCustodyConfirmed:true,environment:'production',bucketName,run});
  assert.equal(result.secret_version_added,true);
  assert.equal(installed.bucket,bucketName);
  assert.equal(installed.prefix,'production');
  assert.equal(installed.keyId,keyId);
  assert.equal(installed.applicationKey,appKey);
  assert.equal(Buffer.from(installed.recoveryKeyBase64,'base64').length,32);
  assert.equal(calls.filter(c=>c.provider==='b2'&&c.args[1]==='create').length,1);
  assert.equal(calls.filter(c=>c.provider==='gcloud'&&c.args[2]==='add').length,1);
  for(const call of calls){
    assert.ok(!call.args.join(' ').includes(appKey));
    assert.ok(!call.args.join(' ').includes(installed.recoveryKeyBase64));
  }
});
