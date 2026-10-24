// One-time, project-isolated owner-local backup setup. Never run in Actions or a captured/shared shell.
// The one-time B2 key and complete backup configuration only pass through process memory
// and the stdin of Google Secret Manager. No credentials or recovery key go to stdout.
import {spawn} from 'node:child_process';
import {readPaperRecoveryKey} from '../memory/paper-recovery-key.mjs';
import {lstat,readFile,realpath} from 'node:fs/promises';
import {isAbsolute,relative,resolve,sep,join,win32} from 'node:path';
import {fileURLToPath,pathToFileURL} from 'node:url';

import {selectBootstrapTarget} from '../hosting/backup-target.mjs';
export {selectBootstrapTarget};
const secretName='JUSTELLE_BACKUP_CONFIG';
export const capabilities=['listFiles','readFiles','writeFiles','readBucketRetentions','readFileRetentions'];

export function validateEndpoint(value){
  let url;
  try{url=new URL(value);}catch{throw Error('Invalid Backblaze S3 endpoint');}
  if(url.protocol!=='https:'||!/^s3\.[a-z0-9-]+\.backblazeb2\.com$/.test(url.hostname)||
    url.pathname!=='/'||url.search||url.hash||url.username||url.password||url.port)
    throw Error('Invalid Backblaze S3 endpoint');
  return url.origin;
}

function inside(parent,path){
  const rel=relative(parent,path);
  return rel===''||rel!=='..'&&!rel.startsWith('..'+sep)&&!isAbsolute(rel);
}
export async function readOfflineRecoveryKey(file,repositoryRoot){
  if(typeof file!=='string'||!isAbsolute(file))throw Error('An absolute owner-controlled recovery-key path is required');
  const current=await realpath(file),root=await realpath(repositoryRoot);
  if(inside(root,current)||/(^|[\\/])onedrive(?:[ \t]*[-–][^\\/]+|[ \t]*\([^\\/]+\))?([\\/]|$)/i.test(current))
    throw Error('Recovery key must be held outside the repository and OneDrive');
  const stat=await lstat(file);
  if(stat.isSymbolicLink()||!stat.isFile()||stat.size!==32)
    throw Error('The owner-held recovery key must be an existing 32-byte regular file');
  const key=await readFile(file);
  if(key.length!==32){key.fill(0);throw Error('The recovery key has an invalid length');}
  return key;
}


export function parseCreatedKey(output){
  // The B2 CLI documents one space-separated line: applicationKeyId applicationKey.
  const s=String(output).trim();
  const m=/^([A-Za-z0-9]{8,128})\s+([^\s]{16,512})$/.exec(s);
  if(!m)throw Error('B2 returned an unexpected key format; inspect and revoke any orphaned key privately');
  return {keyId:m[1],applicationKey:m[2]};
}
export function verifyKeyList(output,keyId,target=selectBootstrapTarget()){
  const {keyName,bucket,prefix}=target;
  const line=String(output).split(/\r?\n/).find(v=>v.trim().split(/\s+/)[0]===keyId);
  if(!line)throw Error('Created B2 key was not visible in the authorised key listing');
  const fields=line.trim().split(/\s+/);
  const observedCapabilities=fields.at(-1)?.split(',').sort();
  if(fields.length<7||fields[1]!==keyName||fields[2]!==bucket||fields.at(-2)!=="'"+prefix+"'"||
     JSON.stringify(observedCapabilities)!==JSON.stringify([...capabilities].sort()))
    throw Error('Created B2 key restrictions did not match the approved scope');
  return true;
}

// Keep Windows command selection independent of PATH and execution policy.
// Provider arguments passed here are fixed by bootstrap(); no secret is an argument.
export function windowsCliInvocation(kind,args,{appData=process.env.APPDATA,comSpec=process.env.ComSpec||'cmd.exe'}={}){
  if(kind==='b2'){
    if(!appData)throw Error('Owner Windows profile is unavailable');
    return {binary:win32.join(appData,'Python','Python312','Scripts','b2.exe'),args};
  }
  if(kind==='gcloud')
    return {binary:comSpec,args:['/d','/s','/c','gcloud.cmd '+args.join(' ')]};
  throw Error('Unsupported private command');
}

async function quietSpawn(binary,args,stdin){
  return new Promise((accept,reject)=>{
    let child;
    try{child=spawn(binary,args,{stdio:['pipe','pipe','pipe'],windowsHide:true,shell:false});}
    catch{reject(Error('Private setup command could not start'));return;}
    const fragments=[];let length=0,overLimit=false,settled=false;
    const fail=()=>{if(!settled){settled=true;reject(Error('Private provider command failed; inspect the account privately'));}};
    child.stdout.on('data',chunk=>{
      length+=chunk.length;
      if(length>65536){overLimit=true;child.kill();return;}
      fragments.push(Buffer.from(chunk));
    });
    child.stderr.on('data',()=>{}); // Never show provider errors: they may carry secret values.
    child.stdin.on('error',()=>{});
    child.once('error',fail);
    child.once('close',code=>{
      if(settled)return;
      if(code!==0||overLimit)return fail();
      const output=Buffer.concat(fragments);
      for(const part of fragments)part.fill(0);
      settled=true;accept(output);
    });
    if(stdin===undefined)child.stdin.end();
    else child.stdin.end(stdin);
  });
}
export function localCliRunner(){
  return async(kind,args,stdin)=>{
    if(kind==='b2'){
      const invocation=process.platform==='win32'?windowsCliInvocation(kind,args):{binary:'b2',args};
      return quietSpawn(invocation.binary,invocation.args,stdin);
    }
    if(kind!=='gcloud')throw Error('Unsupported private command');
    // All Google command arguments are hard-coded below. No secret reaches cmd.exe args.
    if(process.platform==='win32'){
      const invocation=windowsCliInvocation(kind,args);
      return quietSpawn(invocation.binary,invocation.args,stdin);
    }
    return quietSpawn('gcloud',args,stdin);
  };
}

function parseJson(output){
  try{return JSON.parse(String(output));}
  catch{throw Error('Unexpected private provider metadata response');}
}
const googleArgs=(project,...args)=>[...args,'--project='+project,'--quiet'];

// Run exclusively after the owner has independently checked offline custody.
// run is injectable so every failure path can be qualified using synthetic secrets.
export async function bootstrap({endpoint,recoveryKey,offlineCustodyConfirmed,run,
  environment='qualification',bucketName}){
  if(offlineCustodyConfirmed!==true)throw Error('Owner-confirmed independent offline key custody is required');
  const safeEndpoint=validateEndpoint(endpoint);
  if(!Buffer.isBuffer(recoveryKey)||recoveryKey.length!==32)throw Error('Invalid offline recovery key');
  if(typeof run!=='function')throw Error('An authenticated private command runner is required');
  const target=selectBootstrapTarget(environment,bucketName);
  const {project,bucket,prefix,keyName}=target;
  let newId=null,installed=false,fullSecret=null;
  try{
    // Fail before issuing a non-recoverable one-time key if this account or
    // Secret Manager is not accessible, or a backup credential already exists.
    const knownKeys=String(await run('b2',['key','list']));
    if(knownKeys.split(/\r?\n/).some(l=>l.trim().split(/\s+/)[1]===keyName))
      throw Error('A named restricted B2 key already exists; inspect it before retrying');
    const listed=parseJson(await run('gcloud',googleArgs(project,'secrets','list','--format=json')));
    if(!Array.isArray(listed))throw Error('Secret Manager metadata is invalid');
    const exists=listed.some(s=>typeof s.name==='string'&&s.name.split('/').at(-1)===secretName);
    if(!exists)await run('gcloud',googleArgs(project,'secrets','create',secretName,
      '--replication-policy=user-managed','--locations=northamerica-northeast1'));
    const versions=parseJson(await run('gcloud',googleArgs(project,'secrets','versions','list',secretName,'--format=json')));
    if(!Array.isArray(versions)||versions.length!==0)
      throw Error('Backup configuration already has versions; never silently overwrite credentials');
    // The CLI prints the one-time secret on stdout; capture it in memory only.
    const createdOutput=await run('b2',['key','create','--bucket',bucket,'--name-prefix',prefix,
      keyName,capabilities.join(',')]);
    const pair=parseCreatedKey(createdOutput);
    newId=pair.keyId;
    if(Buffer.isBuffer(createdOutput))createdOutput.fill(0);
    const listAfter=await run('b2',['key','list']);
    verifyKeyList(listAfter,newId,target);
    if(Buffer.isBuffer(listAfter))listAfter.fill(0);
    const raw=JSON.stringify({endpoint:safeEndpoint,bucket,keyId:pair.keyId,
      applicationKey:pair.applicationKey,prefix:prefix.slice(0,-1),
      recoveryKeyBase64:recoveryKey.toString('base64')});
    fullSecret=Buffer.from(raw,'utf8');
    await run('gcloud',googleArgs(project,'secrets','versions','add',secretName,'--data-file=-'),fullSecret);
    installed=true;
    return {restricted_key_installed:true,secret_version_added:true,offline_custody_owner_confirmed:true};
  }catch{
    // If Secret Manager refused the new version, do not leave a usable orphan.
    if(newId&&!installed){
      try{await run('b2',['key','delete',newId]);}
      catch{throw Error('Private setup failed and key revocation failed; manually inspect named B2 key before retrying');}
    }
    throw Error('Private B2 bootstrap failed closed; inspect the account and secret metadata before retrying');
  }finally{
    fullSecret?.fill(0);
  }
}

function parseArguments(argv){
  const args={};
  for(let i=0;i<argv.length;i++){
    if(argv[i]==='--offline-custody-confirmed')args.offlineCustodyConfirmed=true;
    else if(argv[i]==='--paper-key')args.paperKey=true;
    else if(['--offline-key','--endpoint','--target','--bucket'].includes(argv[i])&&argv[i+1]){
      const option=argv[i++];
      const name={'--offline-key':'file','--endpoint':'endpoint','--target':'environment','--bucket':'bucketName'}[option];
      args[name]=argv[i];
    }
    else throw Error('Use --paper-key or --offline-key <absolute-file>, --target qualification|production, --bucket <production-bucket>, --endpoint <B2-HTTPS-endpoint> and --offline-custody-confirmed');
  }
  if(Boolean(args.file)===Boolean(args.paperKey)||!args.endpoint||!args.offlineCustodyConfirmed)
    throw Error('Choose exactly one recovery key input method, B2 endpoint and genuine owner custody confirmation');
  args.environment??='qualification';
  selectBootstrapTarget(args.environment,args.bucketName);
  return args;
}
if(process.argv[1]&&import.meta.url===pathToFileURL(resolve(process.argv[1])).href){
  let key;
  try{
    const {file,paperKey,endpoint,offlineCustodyConfirmed,environment,bucketName}=parseArguments(process.argv.slice(2));
    if(paperKey)key=await readPaperRecoveryKey();
    else{
      const root=fileURLToPath(new URL('../',import.meta.url));
      key=await readOfflineRecoveryKey(file,root);
    }
    const result=await bootstrap({endpoint,recoveryKey:key,offlineCustodyConfirmed,
      environment,bucketName,run:localCliRunner()});
    console.log(JSON.stringify(result));
  }catch(e){
    // File system/cloud errors may contain account paths and credentials.
    console.error(e.message?.includes('revocation failed')?
      'Setup failed and B2 key revocation failed; manually inspect the named restricted key.':
      'Secure B2 bootstrap did not complete; check the private operator session and prerequisites.');
    process.exitCode=1;
  }finally{key?.fill(0);}
}
