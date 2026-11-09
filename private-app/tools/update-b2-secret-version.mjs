// Owner-local, append-only repair for an existing qualification backup config.
// This does not create B2 keys or secrets, alter access, or replace the paper
// recovery-key arrangement. Never run in CI or a captured/shared shell.
import {pathToFileURL} from 'node:url';
import {resolve} from 'node:path';
import {readPaperRecoveryKey} from '../memory/paper-recovery-key.mjs';
import {localCliRunner,selectBootstrapTarget,validateEndpoint,verifyKeyList} from './bootstrap-b2-secret.mjs';

const secretName='JUSTELLE_BACKUP_CONFIG';
const project='justelle-qualification';
const keyName='justelle-qualification-backup';

function parseJson(output){
  try{return JSON.parse(String(output));}
  catch{throw Error('Private provider metadata response was invalid');}
}

async function readMetadata(run,args){
  const output=await run('gcloud',args);
  try{return parseJson(output);}
  finally{if(Buffer.isBuffer(output))output.fill(0);}
}

const versionResourcePrefix=`projects/${project}/secrets/${secretName}/versions/`;
function versionNames(list){
  if(!Array.isArray(list)||list.length<1||list.some(v=>typeof v?.name!=='string'||
    !v.name.startsWith(versionResourcePrefix)||!/^\d+$/.test(v.name.slice(versionResourcePrefix.length))))
    throw Error('Secret-version metadata was invalid');
  return list.map(v=>v.name);
}

const gcloudArgs=(...args)=>[...args,'--project='+project,'--quiet'];

/** Safe metadata-only preflight, callable before the owner enters any key material. */
export async function verifyExistingBackupUpdateTarget({keyId,run}){
  if(typeof keyId!=='string'||!/^[A-Za-z0-9]{8,128}$/.test(keyId))throw Error('Invalid existing B2 key identifier');
  if(typeof run!=='function')throw Error('An authenticated private command runner is required');
  const target=selectBootstrapTarget('qualification');
  if(target.project!==project||target.bucket!=='justelle-qualification-backups'||
    target.prefix!=='qualification/'||target.keyName!==keyName)
    throw Error('Qualification backup target did not match the fixed scope');
  const listing=await run('b2',['key','list','--long']);
  try{verifyKeyList(listing,keyId,target);}finally{if(Buffer.isBuffer(listing))listing.fill(0);}
  const versions=await readMetadata(run,gcloudArgs('secrets','versions','list',secretName,'--format=json'));
  versionNames(versions);
  return {existing_key_scope_verified:true,existing_secret_version_present:true};
}

/** Append one complete config version after verifying the existing exact-scope key. */
export async function updateExistingBackupSecretVersion({
  endpoint,keyId,applicationKey,recoveryKey,offlineCustodyConfirmed,run,
}){
  if(offlineCustodyConfirmed!==true)throw Error('Owner-confirmed paper recovery-key custody is required');
  const safeEndpoint=validateEndpoint(endpoint);
  if(typeof keyId!=='string'||!/^[A-Za-z0-9]{8,128}$/.test(keyId))throw Error('Invalid existing B2 key identifier');
  if(typeof applicationKey!=='string'||!/^[^\s]{16,512}$/.test(applicationKey))throw Error('Invalid existing B2 application key');
  if(!Buffer.isBuffer(recoveryKey)||recoveryKey.length!==32)throw Error('Invalid paper recovery key');
  if(typeof run!=='function')throw Error('An authenticated private command runner is required');

  let fullSecret,writeAttempted=false;
  try{
    const target=selectBootstrapTarget('qualification');
    const before=await readMetadata(run,gcloudArgs('secrets','versions','list',secretName,'--format=json'));
    const beforeNames=versionNames(before);
    // Revalidate key scope immediately before the append; the listing is
    // metadata only, and the key value never enters command arguments.
    const keyListing=await run('b2',['key','list','--long']);
    try{verifyKeyList(keyListing,keyId,target);}finally{if(Buffer.isBuffer(keyListing))keyListing.fill(0);}

    fullSecret=Buffer.from(JSON.stringify({
      endpoint:safeEndpoint,bucket:target.bucket,keyId,applicationKey,
      prefix:target.prefix.slice(0,-1),recoveryKeyBase64:recoveryKey.toString('base64'),
    }),'utf8');
    writeAttempted=true;
    const addArgs=gcloudArgs('secrets','versions','add',secretName,'--data-file=-','--format=json');
    const addOutput=await run('gcloud',addArgs,fullSecret);
    let createdName;
    try{
      const created=parseJson(addOutput);
      if(typeof created?.name!=='string'||!created.name.startsWith(versionResourcePrefix)||
        !/^\d+$/.test(created.name.slice(versionResourcePrefix.length))||created.state!=='ENABLED'||
        beforeNames.includes(created.name))
        throw Error('Version response was not the expected new resource');
      createdName=created.name;
    }finally{if(Buffer.isBuffer(addOutput))addOutput.fill(0);}

    // If the write succeeded but readback is ambiguous, report uncertainty; do
    // not encourage a duplicate version or retry.
    const after=await readMetadata(run,gcloudArgs('secrets','versions','list',secretName,'--format=json'));
    const afterNames=versionNames(after);
    const newVersion=after.find(v=>v.name===createdName);
    if(!newVersion||newVersion.state!=='ENABLED'||!beforeNames.every(name=>afterNames.includes(name)))
      throw Error('Secret-version write outcome is uncertain; inspect metadata before any retry');
    return {existing_key_scope_verified:true,secret_version_appended:true,prior_versions_preserved:true,
      key_value_and_recovery_key_association_verified:false};
  }catch(error){
    if(writeAttempted)throw Error('Secret-version write outcome is uncertain; inspect metadata before any retry');
    throw Error('Owner-controlled backup configuration update failed closed; inspect private metadata before retrying');
  }finally{
    fullSecret?.fill(0);
  }
}

function readHiddenLine(input,output,prompt){
  return new Promise((resolveLine,reject)=>{
    const chars=[];let done=false;
    const finish=(error)=>{
      if(done)return;done=true;input.off('data',onData);input.off('end',onEnd);
      output.write('\n');const value=error?null:chars.join('');chars.fill('');
      if(error)reject(error);else resolveLine(value);
    };
    const onEnd=()=>finish(Error('Private credential entry interrupted'));
    const onData=chunk=>{
      for(const ch of chunk.toString('utf8')){
        if(ch==='\r'||ch==='\n'){finish();return;}
        if(ch==='\x03'||ch==='\x04'||ch==='\x1b'){finish(Error('Private credential entry cancelled'));return;}
        if(ch==='\b'||ch==='\x7f'){chars.pop();continue;}
        if(ch<' '||ch>'~'||chars.length>=512){finish(Error('Invalid private credential input'));return;}
        chars.push(ch);
      }
    };
    input.on('data',onData);input.once('end',onEnd);output.write(prompt);
  });
}

async function readExistingKeyId({input=process.stdin,output=process.stderr}={}){
  if((input===process.stdin&&(process.env.CI||process.env.GITHUB_ACTIONS))||
    input?.isTTY!==true||output?.isTTY!==true||typeof input.setRawMode!=='function')
    throw Error('Existing B2 key entry requires a private owner-controlled interactive terminal');
  const prior=Boolean(input.isRaw);let keyId;
  try{
    input.setRawMode(true);input.resume();
    keyId=await readHiddenLine(input,output,'Enter existing restricted B2 key ID (input hidden): ');
    if(!/^[A-Za-z0-9]{8,128}$/.test(keyId))throw Error('Invalid existing B2 key identifier');
    return keyId;
  }catch(error){keyId=undefined;throw error;}
  finally{input.setRawMode(prior);input.pause();}
}

async function readExistingApplicationKey({input=process.stdin,output=process.stderr}={}){
  if((input===process.stdin&&(process.env.CI||process.env.GITHUB_ACTIONS))||
    input?.isTTY!==true||output?.isTTY!==true||typeof input.setRawMode!=='function')
    throw Error('Existing B2 key entry requires a private owner-controlled interactive terminal');
  const prior=Boolean(input.isRaw);let key;
  try{
    input.setRawMode(true);input.resume();
    key=await readHiddenLine(input,output,'Enter its existing application key (input hidden): ');
    if(!/^[^\s]{16,512}$/.test(key))throw Error('Invalid existing B2 application key');
    return key;
  }catch(error){key=undefined;throw error;}
  finally{input.setRawMode(prior);input.pause();}
}

function endpointArgument(argv){
  const i=argv.indexOf('--endpoint');
  if(i<0||!argv[i+1]||argv.filter(v=>v==='--endpoint').length!==1||
    argv.length!==3||!argv.includes('--confirm-existing-key-version-update'))
    throw Error('Use --endpoint <Backblaze-S3-HTTPS-endpoint> --confirm-existing-key-version-update');
  return validateEndpoint(argv[i+1]);
}

if(process.argv[1]&&import.meta.url===pathToFileURL(resolve(process.argv[1])).href){
  let keyId,applicationKey,recoveryKey;
  try{
    if(process.env.CI||process.env.GITHUB_ACTIONS)throw Error('Owner-local execution only');
    const endpoint=endpointArgument(process.argv.slice(2));
    keyId=await readExistingKeyId();
    const run=localCliRunner();
    await verifyExistingBackupUpdateTarget({keyId,run});
    console.error('Enter the retained application key corresponding to the listed key ID; this tool cannot verify the pair without authenticating to B2.');
    applicationKey=await readExistingApplicationKey();
    console.error('Use the SAME paper-held recovery key as the existing backup configuration; the previous Secret Manager value is not read.');
    recoveryKey=await readPaperRecoveryKey();
    const result=await updateExistingBackupSecretVersion({endpoint,keyId,
      applicationKey,recoveryKey,offlineCustodyConfirmed:true,run});
    console.log(JSON.stringify(result));
  }catch(error){
    console.error(error?.message==='Secret-version write outcome is uncertain; inspect metadata before any retry'?
      'Backup configuration version outcome is uncertain; inspect Secret Manager version metadata privately before retrying.':
      'Owner-controlled backup configuration update did not complete; inspect prerequisites privately.');
    process.exitCode=1;
  }finally{
    keyId=undefined;applicationKey=undefined;
    recoveryKey?.fill(0);
  }
}
