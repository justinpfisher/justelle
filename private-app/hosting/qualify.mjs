// Read-only HTTP qualification against ALREADY approved fictional hosting.
// Tokens are loaded from an external file, never logged or stored in the repo.
import {readFile} from 'node:fs/promises';
import {pathToFileURL} from 'node:url';
export async function qualify(c,fetchImpl=fetch){
  const url=new URL(c.origin);
  if(url.protocol!=='https:'||url.origin!==c.origin||!/^[a-z0-9-]+\.web\.app$/.test(url.hostname)||c.room_id!=='fictional-room')throw Error('Only an explicitly configured fictional qualification host is permitted');
  if(!/^[a-z][a-z0-9-]{4,28}[a-z0-9]$/.test(c.project_id||'')||!/^[a-f0-9-]{36}$/.test(c.image_id||'')||!/^[a-zA-Z0-9-]{1,160}$/.test(c.record_id||''))throw Error('Invalid qualification references');
  if(c.bucket!==c.project_id+'.firebasestorage.app'||!c.member_token||!c.outsider_token||!c.revoked_token)throw Error('Member, outsider and revoked fictional tokens are required');
  const record='https://firestore.googleapis.com/v1/projects/'+c.project_id+'/databases/(default)/documents/rooms/'+c.room_id+'/messages/'+c.record_id;
  const storage='https://firebasestorage.googleapis.com/v0/b/'+c.bucket+'/o/'+encodeURIComponent('rooms/'+c.room_id+'/media/'+c.image_id)+'?alt=media';
  const proxy=c.origin+'/api/media/'+c.image_id+'/original';
  const results=[];
  async function check(name,address,token,expected){
    const r=await fetchImpl(address,{redirect:'error',cache:'no-store',headers:token?{Authorization:'Bearer '+token}:{}});
    await r.body?.cancel();
    if(!expected.includes(r.status))throw Error(name+' failed (HTTP '+r.status+')');
    if(address===proxy&&r.status===200&&!/no-store/.test(r.headers.get('cache-control')||''))throw Error('Protected image response must not be cached');
    results.push({name,status:r.status});
  }
  await check('Member record access',record,c.member_token,[200]);
  await check('Member protected original',proxy,c.member_token,[200]);
  for(const [name,token] of [['Unauthenticated',null],['Outsider',c.outsider_token],['Revoked member',c.revoked_token]]){
    await check(name+' record denial',record,token,[401,403]);
    await check(name+' protected original denial',proxy,token,[401,403]);
  }
  for(const token of [null,c.member_token,c.outsider_token])await check('Direct Firebase original denied',storage,token,[401,403]);
  await check('Raw GCS original denied','https://storage.googleapis.com/'+c.bucket+'/rooms/'+c.room_id+'/media/'+c.image_id,null,[401,403]);
  return results;
}
if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href){
  if(!process.argv[2])throw Error('Provide an external fictional qualification file');
  const config=JSON.parse(await readFile(process.argv[2],'utf8'));
  try{console.log(await qualify(config));}finally{for(const k of ['member_token','outsider_token','revoked_token'])config[k]=null;}
}
