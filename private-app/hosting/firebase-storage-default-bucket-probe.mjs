import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {fileURLToPath} from 'node:url';
import {resolve} from 'node:path';

const exec=promisify(execFile);
const operation='FIREBASE_STORAGE_DEFAULT_BUCKET_GET';
const endpoint='https://firebasestorage.googleapis.com/v1alpha/projects/justelle-qualification/defaultBucket';
const maxBodyBytes=64*1024;
const permissionCategories=new Set(['PERMISSION_DENIED','SERVICE_DISABLED','UNAUTHENTICATED']);

async function readBoundedBody(body){
  if(!body)return '';
  const reader=body.getReader();
  const chunks=[];
  let size=0;
  try{
    while(true){
      const {done,value}=await reader.read();
      if(done)break;
      size+=value.byteLength;
      if(size>maxBodyBytes){
        await reader.cancel().catch(()=>{});
        return null;
      }
      chunks.push(Buffer.from(value));
    }
    return Buffer.concat(chunks).toString('utf8');
  }finally{
    try{reader.releaseLock();}catch{}
  }
}

async function categoryFromErrorBody(response){
  let text;
  try{text=await readBoundedBody(response.body);}catch{return 'UNKNOWN';}
  if(text===null||!text)return 'UNKNOWN';
  let body;
  try{body=JSON.parse(text);}catch{return 'UNKNOWN';}
  const status=body?.error?.status;
  return typeof status==='string'&&permissionCategories.has(status)?status:'UNKNOWN';
}

export async function readDefaultBucket({accessToken,fetchImpl=globalThis.fetch}={}){
  if(typeof accessToken!=='string'||!accessToken||accessToken.trim()!==accessToken||
     /\s/.test(accessToken)||accessToken.length>8192)throw new Error('AUTH_CONTEXT_UNAVAILABLE');
  const response=await fetchImpl(endpoint,{
    method:'GET',
    headers:{Authorization:'Bearer '+accessToken},
    redirect:'error',
    signal:AbortSignal.timeout(15000)
  });
  const httpStatus=Number.isInteger(response.status)&&response.status>=100&&response.status<=599
    ?response.status:null;
  if(httpStatus===null)return {operation,httpStatus:null,permissionCategory:'UNKNOWN'};
  if(response.ok)return {operation,httpStatus,permissionCategory:'NONE'};
  return {operation,httpStatus,permissionCategory:await categoryFromErrorBody(response)};
}

async function acquireAccessToken(){
  const {stdout}=await exec('gcloud',['auth','print-access-token'],{
    encoding:'utf8',windowsHide:true,maxBuffer:16*1024
  });
  const token=stdout.trim();
  if(!token||token.length>8192||/\s/.test(token))throw new Error('AUTH_CONTEXT_UNAVAILABLE');
  return token;
}

function emit(result){
  process.stdout.write(JSON.stringify(result)+'\n');
}

async function main(){
  try{
    const accessToken=await acquireAccessToken();
    const result=await readDefaultBucket({accessToken});
    emit(result);
    if(result.httpStatus===null||result.httpStatus<200||result.httpStatus>=300)process.exitCode=1;
  }catch{
    emit({operation,httpStatus:null,permissionCategory:'UNKNOWN'});
    process.exitCode=1;
  }
}

if(process.argv[1]&&fileURLToPath(import.meta.url)===resolve(process.argv[1]))await main();
