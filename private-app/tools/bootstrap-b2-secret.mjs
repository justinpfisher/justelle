// One-time owner-local qualification setup. Never run in Actions or in a captured/shared shell.
// The one-time B2 key and complete backup configuration only pass through process memory
// and the stdin of Google Secret Manager. No credentials or recovery key go to stdout.
import {spawn} from 'node:child_process';
import {timingSafeEqual} from 'node:crypto';
import {lstat,readFile,realpath} from 'node:fs/promises';
import {isAbsolute,relative,resolve,sep,join} from 'node:path';
import {fileURLToPath,pathToFileURL} from 'node:url';

const bucket='justelle-qualification-backups';
const prefix='qualification/';
const keyName='justelle-qualification-backup';
const project='justelle-qualification';
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
  if(inside(root,current)||/(^|[\\/])onedrive([\\/]|$)/i.test(current))
    throw Error('Recovery key must be held outside the repository and OneDrive');
  const stat=await lstat(file);
  if(stat.isSymbolicLink()||!stat.isFile()||stat.size!==32)
    throw Error('The owner-held recovery key must be an existing 32-byte regular file');
  const key=await readFile(file);
  if(key.length!==32){key.fill(0);throw Error('The recovery key has an invalid length');}
  return key;
}


/**
 * Decode a cryptographically generated 32-byte recovery key printed as hex
 * (64 digits, optional spaces/dashes) or canonical Base64 (44 characters).
 * This validates length and encoding, not the entropy of its generation.
 * Never print or log the argument or the returned Buffer.
 */
export function decodePrintedRecoveryKey(value){
  if(typeof value!=='string')throw Error('A printed 32-byte recovery key is required');
  const hex=value.replace(/[\s-]/g,'');
  if(/^[a-fA-F0-9]{64}$/.test(hex))return Buffer.from(hex,'hex');
  const b64=value.replace(/\s/g,'');
  if(/^[A-Za-z0-9+/]{43}=$/.test(b64)){
    const bytes=Buffer.from(b64,'base64');
    if(bytes.length===32&&bytes.toString('base64')===b64)return bytes;
    bytes.fill(0);
  }
  throw Error('Printed recovery key must be 64 hexadecimal characters or 44 canonical Base64 characters');
}

// Input is intentionally read in raw mode: readline/Read-Host can echo the
// secret or place it in history. Only a genuine owner-controlled local TTY
// can be used, never redirected stdin or a captured agent execution.
function hiddenTTYLine(input,output,prompt){
  return new Promise((resolve,reject)=>{
    const chars=[];
    let finished=false;
    function finish(error){
      if(finished)return;
      finished=true;
      input.off('data',onData);
      input.off('end',onEnd);
      output.write('\n');
      const entered=error?null:chars.join('');
      chars.fill('');
      if(error)reject(error);else resolve(entered);
    }
    function onEnd(){finish(Error('Private recovery key entry was interrupted'));}
    function onData(data){
      for(const ch of data.toString('utf8')){
        if(ch==='\r'||ch==='\n'){finish(null);return;}
        if(ch==='\x03'||ch==='\x04'||ch==='\x1b'){
          finish(Error('Private recovery key entry was cancelled'));return;
        }
        if(ch==='\b'||ch==='\x7f'){chars.pop();continue;}
        if(ch<' '||ch>'~'||chars.length>=128){
          finish(Error('Invalid recovery key input; nothing was installed'));return;
        }
        chars.push(ch);
      }
    }
    input.on('data',onData);
    input.once('end',onEnd);
    output.write(prompt);
  });
}
export async function readPaperRecoveryKey({input=process.stdin,output=process.stderr}={}){
  if(process.env.CI||process.env.GITHUB_ACTIONS||input?.isTTY!==true||output?.isTTY!==true||
     typeof input.setRawMode!=='function')
    throw Error('Paper recovery entry requires a private owner-controlled interactive terminal');
  const priorRaw=Boolean(input.isRaw);
  let first,second;
  try{
    input.setRawMode(true);
    input.resume();
    const firstText=await hiddenTTYLine(input,output,'Enter printed Justelle recovery key (input hidden): ');
    first=decodePrintedRecoveryKey(firstText);
    const secondText=await hiddenTTYLine(input,output,'Re-enter the printed key to verify (input hidden): ');
    second=decodePrintedRecoveryKey(secondText);
    if(!timingSafeEqual(first,second))throw Error('Printed key entries do not match; nothing was installed');
    return first;
  }catch(error){
    first?.fill(0);
    throw error;
  }finally{
    second?.fill(0);
    input.setRawMode(priorRaw);
    input.pause();
  }
}

export function parseCreatedKey(output){
  // The B2 CLI documents one space-separated line: applicationKeyId applicationKey.
  const s=String(output).trim();
  const m=/^([A-Za-z0-9]{8,128})\s+([^\s]{16,512})$/.exec(s);
  if(!m)throw Error('B2 returned an unexpected key format; inspect and revoke any orphaned key privately');
  return {keyId:m[1],applicationKey:m[2]};
}
export function verifyKeyList(output,keyId){
  const line=String(output).split(/\r?\n/).find(v=>v.trim().split(/\s+/)[0]===keyId);
  if(!line)throw Error('Created B2 key was not visible in the authorised key listing');
  const fields=line.trim().split(/\s+/);
  const observedCapabilities=fields.at(-1)?.split(',').sort();
  if(fields.length<7||fields[1]!==keyName||fields[2]!==bucket||fields.at(-2)!=="'"+prefix+"'"||
     JSON.stringify(observedCapabilities)!==JSON.stringify([...capabilities].sort()))
    throw Error('Created B2 key restrictions did not match the approved scope');
  return true;
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
      if(process.platform==='win32'&&!process.env.APPDATA)throw Error('Owner Windows profile is unavailable');
      const cmd=process.platform==='win32'?join(process.env.APPDATA,'Python','Python312','Scripts','b2.exe'):'b2';
      return quietSpawn(cmd,args,stdin);
    }
    if(kind!=='gcloud')throw Error('Unsupported private command');
    // All Google command arguments are hard-coded below. No secret reaches cmd.exe args.
    if(process.platform==='win32'){
      return quietSpawn(process.env.ComSpec||'cmd.exe',['/d','/s','/c','gcloud.cmd '+args.join(' ')],stdin);
    }
    return quietSpawn('gcloud',args,stdin);
  };
}

function parseJson(output){
  try{return JSON.parse(String(output));}
  catch{throw Error('Unexpected private provider metadata response');}
}
const googleArgs=(...args)=>[...args,'--project='+project,'--quiet'];

// Run exclusively after the owner has independently checked offline custody.
// run is injectable so every failure path can be qualified using synthetic secrets.
export async function bootstrap({endpoint,recoveryKey,offlineCustodyConfirmed,run}){
  if(offlineCustodyConfirmed!==true)throw Error('Owner-confirmed independent offline key custody is required');
  const safeEndpoint=validateEndpoint(endpoint);
  if(!Buffer.isBuffer(recoveryKey)||recoveryKey.length!==32)throw Error('Invalid offline recovery key');
  if(typeof run!=='function')throw Error('An authenticated private command runner is required');
  let newId=null,installed=false,fullSecret=null;
  try{
    // Fail before issuing a non-recoverable one-time key if this account or
    // Secret Manager is not accessible, or a backup credential already exists.
    const knownKeys=String(await run('b2',['key','list']));
    if(knownKeys.split(/\r?\n/).some(l=>l.trim().split(/\s+/)[1]===keyName))
      throw Error('A named restricted B2 key already exists; inspect it before retrying');
    const listed=parseJson(await run('gcloud',googleArgs('secrets','list','--format=json')));
    if(!Array.isArray(listed))throw Error('Secret Manager metadata is invalid');
    const exists=listed.some(s=>typeof s.name==='string'&&s.name.split('/').at(-1)===secretName);
    if(!exists)await run('gcloud',googleArgs('secrets','create',secretName,
      '--replication-policy=user-managed','--locations=northamerica-northeast1'));
    const versions=parseJson(await run('gcloud',googleArgs('secrets','versions','list',secretName,'--format=json')));
    if(!Array.isArray(versions)||versions.length!==0)
      throw Error('Backup configuration already has versions; never silently overwrite credentials');
    // The CLI prints the one-time secret on stdout; capture it in memory only.
    const createdOutput=await run('b2',['key','create','--bucket',bucket,'--name-prefix',prefix,
      keyName,capabilities.join(',')]);
    const pair=parseCreatedKey(createdOutput);
    newId=pair.keyId;
    if(Buffer.isBuffer(createdOutput))createdOutput.fill(0);
    const listAfter=await run('b2',['key','list']);
    verifyKeyList(listAfter,newId);
    if(Buffer.isBuffer(listAfter))listAfter.fill(0);
    const raw=JSON.stringify({endpoint:safeEndpoint,bucket,keyId:pair.keyId,
      applicationKey:pair.applicationKey,prefix:'qualification',
      recoveryKeyBase64:recoveryKey.toString('base64')});
    fullSecret=Buffer.from(raw,'utf8');
    await run('gcloud',googleArgs('secrets','versions','add',secretName,'--data-file=-'),fullSecret);
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
    else if(['--offline-key','--endpoint'].includes(argv[i])&&argv[i+1]){
      const option=argv[i++];args[option==='--offline-key'?'file':'endpoint']=argv[i];
    }
    else throw Error('Use either --paper-key or --offline-key <absolute-owner-held-file>, plus --endpoint <B2-S3-HTTPS-endpoint> --offline-custody-confirmed');
  }
  if(Boolean(args.file)===Boolean(args.paperKey)||!args.endpoint||!args.offlineCustodyConfirmed)
    throw Error('Choose exactly one recovery key input method, B2 endpoint and genuine owner custody confirmation');
  return args;
}
if(process.argv[1]&&import.meta.url===pathToFileURL(resolve(process.argv[1])).href){
  let key;
  try{
    const {file,paperKey,endpoint,offlineCustodyConfirmed}=parseArguments(process.argv.slice(2));
    if(paperKey)key=await readPaperRecoveryKey();
    else{
      const root=fileURLToPath(new URL('../',import.meta.url));
      key=await readOfflineRecoveryKey(file,root);
    }
    const result=await bootstrap({endpoint,recoveryKey:key,offlineCustodyConfirmed,run:localCliRunner()});
    console.log(JSON.stringify(result));
  }catch(e){
    // File system/cloud errors may contain account paths and credentials.
    console.error(e.message?.includes('revocation failed')?
      'Setup failed and B2 key revocation failed; manually inspect the named restricted key.':
      'Secure B2 bootstrap did not complete; check the private operator session and prerequisites.');
    process.exitCode=1;
  }finally{key?.fill(0);}
}
