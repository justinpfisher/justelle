import test from 'node:test';
import assert from 'node:assert/strict';
import {updateExistingBackupSecretVersion,verifyExistingBackupUpdateTarget} from '../tools/update-b2-secret-version.mjs';
import {capabilities} from '../tools/bootstrap-b2-secret.mjs';

const endpoint='https://s3.us-west-004.backblazeb2.com';
const keyId='syntheticKeyId123';
const applicationKey='SYNTHETIC_ONLY_application_key_123';
const projectNumber='123456789012';
const keyLine=keyId+' justelle-qualification-backup justelle-qualification-backups - - \'qualification/\' '+capabilities.join(',');

function fakeRun({scope=keyLine,resourceProject=projectNumber,appendProject=resourceProject,afterProject=resourceProject,initialVersions=2,afterCount,failWrite=false,failAfterAdd=false,
  failWriteConcurrent=false}={}){
  const calls=[];let versions=initialVersions,stdinCopy;
  const run=async(provider,args,stdin)=>{
    calls.push({provider,args:[...args]});
    if(provider==='b2'&&args.join(' ')==='key list --long')return scope;
    if(provider==='gcloud'&&args.includes('versions')&&args.includes('list')){
      if(failAfterAdd&&versions>initialVersions)throw Error('synthetic metadata readback failure');
      return JSON.stringify(Array.from({length:afterCount??versions},(_,i)=>({
        name:`projects/${versions>initialVersions?afterProject:resourceProject}/secrets/JUSTELLE_BACKUP_CONFIG/versions/${i+1}`,state:'ENABLED',
      })));
    }
    if(provider==='gcloud'&&args.includes('versions')&&args.includes('add')){
      if(failWriteConcurrent){versions++;throw Error('synthetic provider failure');}
      if(failWrite)throw Error('synthetic provider failure');
      stdinCopy=Buffer.from(stdin);versions++;
      return JSON.stringify({name:`projects/${appendProject}/secrets/JUSTELLE_BACKUP_CONFIG/versions/${versions}`,state:'ENABLED'});
    }
    throw Error('Unexpected synthetic command');
  };
  return {run,calls,get stdinCopy(){return stdinCopy;}};
}

const call=(runner,overrides={})=>updateExistingBackupSecretVersion({
  endpoint,keyId,applicationKey,recoveryKey:Buffer.alloc(32,7),
  offlineCustodyConfirmed:true,run:runner.run,...overrides,
});

test('appends one synthetic version for the exact existing scoped key and preserves paper recovery value',async()=>{
  const fake=fakeRun();
  const result=await call(fake);
  assert.deepEqual(result,{existing_key_scope_verified:true,secret_version_appended:true,
    prior_versions_preserved:true,key_value_and_recovery_key_association_verified:false});
  assert.deepEqual(fake.calls.filter(c=>c.provider==='b2').map(c=>c.args),[['key','list','--long']]);
  assert.equal(fake.calls.filter(c=>c.provider==='gcloud'&&c.args.includes('add')).length,1);
  assert.ok(fake.calls.every(c=>!c.args.join(' ').includes(applicationKey)));
  const config=JSON.parse(fake.stdinCopy.toString('utf8'));
  assert.equal(config.keyId,keyId);assert.equal(config.applicationKey,applicationKey);
  assert.equal(config.bucket,'justelle-qualification-backups');
  assert.equal(config.prefix,'qualification');
  assert.equal(Buffer.from(config.recoveryKeyBase64,'base64').length,32);
  fake.stdinCopy.fill(0);
});

test('metadata-only preflight verifies existing scope/version before any credential input or write',async()=>{
  const fake=fakeRun();
  assert.deepEqual(await verifyExistingBackupUpdateTarget({keyId,run:fake.run}),
    {existing_key_scope_verified:true,existing_secret_version_present:true});
  assert.deepEqual(fake.calls.map(c=>[c.provider,c.args.slice(0,3)]),[
    ['b2',['key','list','--long']],['gcloud',['secrets','versions','list']],
  ]);
  assert.equal(fake.calls.some(c=>c.args.includes('add')||c.args.includes('create')),false);
});

test('accepts canonical numeric Secret Manager project resource names',async()=>{
  const fake=fakeRun();
  assert.deepEqual(await verifyExistingBackupUpdateTarget({keyId,run:fake.run}),
    {existing_key_scope_verified:true,existing_secret_version_present:true});
  const result=await call(fake);
  assert.equal(result.secret_version_appended,true);
  assert.equal(result.prior_versions_preserved,true);
});

test('rejects project-ID and mixed-project version resource names',async()=>{
  for(const fake of [fakeRun({resourceProject:'justelle-qualification'})])
    await assert.rejects(verifyExistingBackupUpdateTarget({keyId,run:fake.run}),/metadata/i);
  const mixed=fakeRun();
  const original=mixed.run;
  let listCount=0;
  mixed.run=async(provider,args,stdin)=>{
    const result=await original(provider,args,stdin);
    if(provider==='gcloud'&&args.includes('versions')&&args.includes('list')&&++listCount===1){
      const rows=JSON.parse(result);rows[1].name='projects/987654321098/secrets/JUSTELLE_BACKUP_CONFIG/versions/2';
      return JSON.stringify(rows);
    }
    return result;
  };
  await assert.rejects(verifyExistingBackupUpdateTarget({keyId,run:mixed.run}),/metadata/i);
});

test('rejects append and readback names that differ from the canonical numeric project returned by listing',async()=>{
  for(const fake of [fakeRun({appendProject:'987654321098'}),fakeRun({afterProject:'987654321098'})]){
    await assert.rejects(call(fake),/outcome is uncertain/);
    assert.equal(fake.calls.filter(c=>c.args.includes('add')).length,1);
  }
});

test('refuses wrong key scope, missing existing version, bad custody, and invalid inputs before write',async()=>{
  for(const fake of [fakeRun({scope:keyLine.replace('qualification/','wrong/')})])
    await assert.rejects(call(fake),/failed closed/);
  await assert.rejects(call(fakeRun({initialVersions:0})),/failed closed/);
  const noCustody=fakeRun();
  await assert.rejects(call(noCustody,{offlineCustodyConfirmed:false}),/Owner-confirmed/);
  assert.equal(noCustody.calls.length,0);
  const badEndpoint=fakeRun();
  await assert.rejects(call(badEndpoint,{endpoint:'https://example.invalid'}),/Invalid Backblaze/);
  assert.equal(badEndpoint.calls.length,0);
  for(const fake of [fakeRun({scope:keyLine.replace('readFileRetentions','deleteFiles')})]){
    await assert.rejects(call(fake),/failed closed/);
    assert.equal(fake.calls.some(c=>c.args.includes('add')),false);
  }
});

test('never creates or deletes B2 keys/secrets and preserves prior versions on a failed append',async()=>{
  const fake=fakeRun({failWrite:true});
  await assert.rejects(call(fake),error=>{
    assert.match(error.message,/outcome is uncertain/);
    assert.ok(!error.message.includes(applicationKey));
    assert.ok(!error.message.includes(Buffer.alloc(32,7).toString('base64')));
    assert.ok(!error.message.includes('synthetic provider failure'));
    return true;
  });
  assert.equal(fake.calls.some(c=>c.args.includes('create')||c.args.includes('delete')),false);
  assert.equal(fake.calls.filter(c=>c.args.includes('add')).length,1);
});

test('reports uncertain write or metadata-readback outcomes distinctly and never retries',async()=>{
  for(const fake of [fakeRun({afterCount:2}),fakeRun({failAfterAdd:true}),
    fakeRun({failWriteConcurrent:true})]){
    await assert.rejects(call(fake),/outcome is uncertain/);
    assert.equal(fake.calls.filter(c=>c.args.includes('add')).length,1);
  }
});
