// One-time, project-isolated owner-local backup setup. Never run in Actions or a captured/shared shell.
// The one-time B2 key and complete backup configuration only pass through process memory
// and the stdin of Google Secret Manager. No credentials or recovery key go to stdout.
import {spawn} from 'node:child_process';
import {readPaperRecoveryKey} from '../memory/paper-recovery-key.mjs';
import {lstat,readFile,realpath} from 'node:fs/promises';
import {isAbsolute,relative,resolve,sep} from 'node:path';
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

// B2's installed Python package supplies the version-stable v5 module entrypoint.
// Use the same Windows Python launcher already used for "py -m pip", rather than
// assuming pip wrote b2.exe to a particular Scripts directory. No shell is used.
// Google Cloud uses gcloud.cmd via cmd.exe, not the blocked gcloud.ps1 wrapper.
// All arguments come from fixed bootstrap commands; no secrets are command args.
export function windowsCliInvocation(kind,args,{comSpec=process.env.ComSpec||'cmd.exe'}={}){
  if(kind==='b2')return {binary:'py',args:['-m','b2._internal.b2v5',...args]};
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
const secretVersionPattern=/^projects\/(\d+)\/secrets\/JUSTELLE_BACKUP_CONFIG\/versions\/(\d+)$/;
async function existingSecretVersions(run,project){
  const output=await run('gcloud',googleArgs(project,'secrets','versions','list',secretName,'--format=json'));
  try{
    const versions=parseJson(output);
    if(!Array.isArray(versions)||versions.length===0||versions.some(v=>typeof v?.name!=='string'))
      throw Error('Secret-version metadata was invalid');
    const matches=versions.map(v=>secretVersionPattern.exec(v.name));
    if(matches.some(match=>!match))throw Error('Secret-version metadata was invalid');
    const projectNumber=matches[0][1];
    if(matches.some(match=>match[1]!==projectNumber))throw Error('Secret-version metadata was invalid');
    const names=versions.map(v=>v.name);
    if(new Set(names).size!==names.length)throw Error('Secret-version metadata was invalid');
    return {projectNumber,names,versions};
  }finally{if(Buffer.isBuffer(output))output.fill(0);}
}

// Run exclusively after the owner has independently checked offline custody.
// run is injectable so every failure path can be qualified using synthetic secrets.
export async function bootstrap({endpoint,recoveryKey,offlineCustodyConfirmed,run,
  environment='qualification',bucketName,appendExistingSecretVersion=false}){
  if(offlineCustodyConfirmed!==true)throw Error('Owner-confirmed independent offline key custody is required');
  const safeEndpoint=validateEndpoint(endpoint);
  if(!Buffer.isBuffer(recoveryKey)||recoveryKey.length!==32)throw Error('Invalid offline recovery key');
  if(typeof run!=='function')throw Error('An authenticated private command runner is required');
  if(typeof appendExistingSecretVersion!=='boolean')throw Error('Invalid secret version mode');
  const target=selectBootstrapTarget(environment,bucketName);
  const {project,bucket,prefix,keyName}=target;
  if(appendExistingSecretVersion&&(environment!=='qualification'||bucket!=='justelle-qualification-backups'||bucketName!==undefined))
    throw Error('Append mode is limited to the fixed qualification backup target');
  let newId=null,fullSecret=null,writeAttempted=false,keyCreateAttempted=false;
  try{
    // Fail before issuing a non-recoverable one-time key if this account or
    // Secret Manager is not accessible, or a backup credential already exists.
    // CLI v5 defaults to ID/name only; the scope audit needs --long.
    const knownKeyOutput=await run('b2',['key','list','--long']);
    try{
      const knownKeys=String(knownKeyOutput);
      if(knownKeys.split(/\r?\n/).some(l=>l.trim().split(/\s+/)[1]===keyName))
        throw Error('A named restricted B2 key already exists; inspect it before retrying');
    }finally{if(Buffer.isBuffer(knownKeyOutput))knownKeyOutput.fill(0);}
    const secretListOutput=await run('gcloud',googleArgs(project,'secrets','list','--format=json'));
    let exists;
    try{
      const listed=parseJson(secretListOutput);
      if(!Array.isArray(listed))throw Error('Secret Manager metadata is invalid');
      const matches=listed.filter(s=>typeof s.name==='string'&&s.name.split('/').at(-1)===secretName);
      if(matches.length>1)throw Error('Secret Manager metadata is ambiguous');
      exists=matches.length===1;
    }finally{if(Buffer.isBuffer(secretListOutput))secretListOutput.fill(0);}
    if(appendExistingSecretVersion&&!exists)
      throw Error('Append mode requires the existing qualification secret');
    if(!exists&&!appendExistingSecretVersion)
      await run('gcloud',googleArgs(project,'secrets','create',secretName,
        '--replication-policy=user-managed','--locations=northamerica-northeast1'));
    let beforeVersions=null;
    if(appendExistingSecretVersion){
      beforeVersions=await existingSecretVersions(run,project);
      if(!beforeVersions.versions.some(v=>v.state==='ENABLED'))
        throw Error('Append mode requires an enabled existing secret version');
    }else{
      const versionsOutput=await run('gcloud',googleArgs(project,'secrets','versions','list',secretName,'--format=json'));
      try{
        const versions=parseJson(versionsOutput);
        if(!Array.isArray(versions)||versions.length!==0)
          throw Error('Backup configuration already has versions; never silently overwrite credentials');
      }finally{if(Buffer.isBuffer(versionsOutput))versionsOutput.fill(0);}
    }
    // The CLI prints the one-time secret on stdout; capture it in memory only.
    keyCreateAttempted=true;
    const createdOutput=await run('b2',['key','create','--bucket',bucket,'--name-prefix',prefix,
      keyName,capabilities.join(',')]);
    let pair;
    try{pair=parseCreatedKey(createdOutput);newId=pair.keyId;}
    finally{if(Buffer.isBuffer(createdOutput))createdOutput.fill(0);}
    const listAfter=await run('b2',['key','list','--long']);
    try{verifyKeyList(listAfter,newId,target);}finally{if(Buffer.isBuffer(listAfter))listAfter.fill(0);}
    fullSecret=Buffer.from(JSON.stringify({endpoint:safeEndpoint,bucket,keyId:pair.keyId,
      applicationKey:pair.applicationKey,prefix:prefix.slice(0,-1),
      recoveryKeyBase64:recoveryKey.toString('base64')}),'utf8');
    pair.applicationKey='';
    const addArgs=googleArgs(project,'secrets','versions','add',secretName,'--data-file=-',
      ...(appendExistingSecretVersion?['--format=json']:[]));
    writeAttempted=true;
    const addOutput=await run('gcloud',addArgs,fullSecret);
    if(appendExistingSecretVersion){
      let createdName;
      try{
        const created=parseJson(addOutput);
        const match=typeof created?.name==='string'&&secretVersionPattern.exec(created.name);
        if(!match||match[1]!==beforeVersions.projectNumber||created.state!=='ENABLED'||
          beforeVersions.names.includes(created.name))
          throw Error('Secret-version response was not the expected new resource');
        createdName=created.name;
      }finally{if(Buffer.isBuffer(addOutput))addOutput.fill(0);}
      const after=await existingSecretVersions(run,project);
      const createdVersion=after.versions.find(v=>v.name===createdName);
      if(after.projectNumber!==beforeVersions.projectNumber||after.names.length!==beforeVersions.names.length+1||
        !beforeVersions.names.every(name=>after.names.includes(name))||createdVersion?.state!=='ENABLED')
        throw Error('Secret-version append outcome is uncertain; inspect metadata before retrying');
      return {restricted_key_installed:true,secret_version_added:true,prior_versions_preserved:true,
        offline_custody_owner_confirmed:true};
    }
    if(Buffer.isBuffer(addOutput))addOutput.fill(0);
    return {restricted_key_installed:true,secret_version_added:true,offline_custody_owner_confirmed:true};
  }catch{
    // Before an append attempt, revoke a key that cannot be safely installed.
    // Once append starts, keep the key: a timed-out response may still have
    // created a version that references it. Reconcile metadata before cleanup.
    if(newId&&(!writeAttempted||!appendExistingSecretVersion)){
      try{await run('b2',['key','delete',newId]);}
      catch{throw Error('Private setup failed and key revocation failed; manually inspect named B2 key before retrying');}
    }
    if(keyCreateAttempted&&!newId)
      throw Error('Restricted key creation outcome is uncertain; inspect B2 key metadata privately before retrying');
    if(newId&&writeAttempted&&appendExistingSecretVersion)
      throw Error('Backup configuration append outcome is uncertain; keep the restricted key and inspect secret-version metadata privately before retrying');
    throw Error('Private B2 bootstrap failed closed; inspect the account and secret metadata before retrying');
  }finally{
    fullSecret?.fill(0);
  }
}

export function parseArguments(argv){
  const args={};
  for(let i=0;i<argv.length;i++){
    if(argv[i]==='--offline-custody-confirmed')args.offlineCustodyConfirmed=true;
    else if(argv[i]==='--paper-key')args.paperKey=true;
    else if(argv[i]==='--append-existing-version')args.appendExistingSecretVersion=true;
    else if(['--offline-key','--endpoint','--target','--bucket'].includes(argv[i])&&argv[i+1]){
      const option=argv[i++];
      const name={'--offline-key':'file','--endpoint':'endpoint','--target':'environment','--bucket':'bucketName'}[option];
      args[name]=argv[i];
    }
    else throw Error('Use --paper-key or --offline-key <absolute-file>, --target qualification|production, --bucket <production-bucket>, --endpoint <B2-HTTPS-endpoint>, --offline-custody-confirmed, and optionally --append-existing-version for an existing qualification secret');
  }
  if(Boolean(args.file)===Boolean(args.paperKey)||!args.endpoint||!args.offlineCustodyConfirmed)
    throw Error('Choose exactly one recovery key input method, B2 endpoint and genuine owner custody confirmation');
  args.environment??='qualification';
  if(args.appendExistingSecretVersion&&(args.environment!=='qualification'||args.bucketName!==undefined))
    throw Error('Append-existing-version mode is limited to the fixed qualification target');
  selectBootstrapTarget(args.environment,args.bucketName);
  return args;
}
if(process.argv[1]&&import.meta.url===pathToFileURL(resolve(process.argv[1])).href){
  let key;
  try{
    const {file,paperKey,endpoint,offlineCustodyConfirmed,environment,bucketName,appendExistingSecretVersion}=parseArguments(process.argv.slice(2));
    if(paperKey)key=await readPaperRecoveryKey();
    else{
      const root=fileURLToPath(new URL('../',import.meta.url));
      key=await readOfflineRecoveryKey(file,root);
    }
    const result=await bootstrap({endpoint,recoveryKey:key,offlineCustodyConfirmed,
      environment,bucketName,appendExistingSecretVersion,run:localCliRunner()});
    console.log(JSON.stringify(result));
  }catch(e){
    // File system/cloud errors may contain account paths and credentials.
    console.error(e.message?.includes('revocation failed')?
      'Setup failed and B2 key revocation failed; manually inspect the named restricted key.':
      'Secure B2 bootstrap did not complete; check the private operator session and prerequisites.');
    process.exitCode=1;
  }finally{key?.fill(0);}
}
