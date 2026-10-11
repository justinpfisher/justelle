import {test} from 'node:test';
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {readFile,mkdtemp,readdir} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {generateKeyPairSync, sign} from 'node:crypto';
import {makeWorker} from '../cloudflare/src/index.mjs';
import {validateFirebaseJwt} from '../cloudflare/src/identity.mjs';
import {restoreArchive} from '../common/restore.mjs';

class LocalD1 {
 constructor(){this.db=new DatabaseSync(':memory:');this.db.exec('PRAGMA foreign_keys=ON;');}
 exec(sql){this.db.exec(sql);return this;}
 prepare(sql){const stmt=this.db.prepare(sql);return {bind:(...v)=>({
  all:async()=>({results:stmt.all(...v)}),first:async()=>stmt.get(...v)||null,run:async()=>stmt.run(...v),
  _run:()=>stmt.run(...v)
 })};}
 async batch(items){this.db.exec('BEGIN TRANSACTION');try{const res=items.map(x=>x._run());this.db.exec('COMMIT');return res;}catch(e){this.db.exec('ROLLBACK');throw e;}}
}
class LocalR2 {
 constructor(){this.files=new Map();}
 async put(key,bytes){this.files.set(key,Buffer.from(bytes));}
 async get(key){const b=this.files.get(key);if(!b)return null;return {body:b,arrayBuffer:async()=>b.buffer.slice(b.byteOffset,b.byteOffset+b.byteLength)};}
 async delete(key){this.files.delete(key);}
}
const b64=x=>Buffer.from(typeof x==='string'?x:JSON.stringify(x)).toString('base64url');
const {privateKey,publicKey}=generateKeyPairSync('rsa',{modulusLength:2048});
const jwk=publicKey.export({format:'jwk'});jwk.kid='local-rsa';jwk.alg='RS256';jwk.use='sig';
function issue(uid,overrides={}){
 const ts=Math.floor(Date.now()/1000);
 const h=b64({alg:'RS256',typ:'JWT',kid:'local-rsa'});
 const p=b64({iss:'https://securetoken.google.com/demo-justelle-poc',aud:'demo-justelle-poc',sub:uid,iat:ts,auth_time:ts,exp:ts+3600,justelle_room:'fictional-room',justelle_member:true,...overrides});
 return `${h}.${p}.${sign('RSA-SHA256',Buffer.from(`${h}.${p}`),privateKey).toString('base64url')}`;
}
const member1='fictional-a',member2='fictional-b',outsider='outsider';
const users={a:issue(member1),b:issue(member2),x:issue(outsider),expired:issue(member1,{exp:1}),wrong:issue(member1,{justelle_room:'different-room'})};
const actor=async request=>{
 const token=request.headers.get('Authorization')?.replace(/^Bearer /,'');
 if(!token)return null;
 try{
  const c=await validateFirebaseJwt(token,'demo-justelle-poc',async()=>[jwk]);
  if(c.justelle_member!==true||c.justelle_room!=='fictional-room'||![member1,member2].includes(c.sub))return null;
  return {uid:c.sub,personId:c.sub===member1?'person-a':'person-b',members:[member1,member2]};
 }catch{return null;}
};
const png=await readFile(new URL('../fixtures/fictional-landscape.png',import.meta.url)); // entirely synthetic image

async function setup(){
 const DB=new LocalD1(); DB.exec(await readFile(new URL('../cloudflare/sql/0001_init.sql',import.meta.url),'utf8'));
 const MEDIA=new LocalR2(); const env={DB,MEDIA,ROOM_ID:'fictional-room',FIREBASE_PROJECT_ID:'demo-justelle-poc',MEMBER_MAP_JSON:JSON.stringify({[member1]:'person-a',[member2]:'person-b'})};
 const worker=makeWorker(actor);
 async function req(path,user,method='GET',data=null,contentType=null){
  const headers={};if(user)headers.Authorization=`Bearer ${users[user]}`;
  if(contentType)headers['Content-Type']=contentType;
  else if(data!==null)headers['Content-Type']='application/json';
  const body=data===null?undefined:(contentType==='image/png'?data:JSON.stringify(data));
  const r=await worker.fetch(new Request(`https://app.justelle.example${path}`,{method,headers,body}),env);
  return {status:r.status,json:async()=>r.json(),text:async()=>r.text(),buffer:async()=>Buffer.from(await r.arrayBuffer()), headers:r.headers};
 }
 return {req,env,worker};
}

test('Cloudflare: signed authentication rejects missing, expired, wrong-room and third-party tokens',async()=>{
 const {req}=await setup();
 for(const user of [null,'expired','wrong','x']) assert.equal((await req('/api/messages',user)).status,401);
 assert.equal((await req('/api/messages','a')).status,200);
 const forged=issue(member1); const parts=forged.split('.');parts[1]=b64({...JSON.parse(Buffer.from(parts[1],'base64url').toString()),sub:'outsider'});
 await assert.rejects(()=>validateFirebaseJwt(parts.join('.'),'demo-justelle-poc',async()=>[jwk]));
});

test('Cloudflare: shared messages visible to two authenticated users, outsiders denied',async()=>{
 const {req}=await setup();
 assert.equal((await req('/api/messages','a','POST',{body:'Fictional: consider the moon museum.'})).status,201);
 assert.equal((await req('/api/messages','b','POST',{body:'Fictional: a meteor garden could be fun.'})).status,201);
 const visible=await (await req('/api/messages','b')).json();
 assert.equal(visible.length,2); assert.equal(visible[0].author_id,'person-a');
 assert.equal((await req('/api/messages','x')).status,401);
});

test('Cloudflare: AI-style proposal remains proposed until both approvals; locked decisions not editable',async()=>{
 const {req}=await setup();
 const created=await (await req('/api/decisions','a','POST',{body:'Fictional proposal: visit the moon museum.'})).json();
 assert.equal((await (await req(`/api/decisions/${created.id}/approve`,'a','POST')).json()).status,'proposed');
 assert.equal((await (await req(`/api/decisions/${created.id}/approve`,'a','POST')).json()).status,'proposed');
 assert.equal((await req(`/api/decisions/${created.id}/approve`,'x','POST')).status,401);
 assert.equal((await (await req(`/api/decisions/${created.id}/approve`,'b','POST')).json()).status,'locked');
 assert.equal((await req(`/api/decisions/${created.id}`,'a','PATCH',{body:'overwrite'})).status,404);
 assert.equal((await (await req('/api/decisions','a')).json())[0].status,'locked');
});

test('Cloudflare: media denied without authorisation, cannot enumerate raw object keys, headers are private',async()=>{
 const {req,env}=await setup();
 const created=await (await req('/api/media','a','POST',png,'image/png')).json();
 assert.equal((await req(`/api/media/${created.id}`,null)).status,401);
 assert.equal((await req(`/api/media/${created.id}`,'x')).status,401);
 const ok=await req(`/api/media/${created.id}`,'b');
 assert.equal(ok.status,200); assert.equal(ok.headers.get('cache-control'),'private, no-store');
 assert.deepEqual(await ok.buffer(),png);
 const rawKey=[...env.MEDIA.files.keys()][0];
 assert.equal((await req(`/api/media/${rawKey}`,'a')).status,404);
 assert.equal((await req('/api/media','a','POST',Buffer.from('not an image'),'image/png')).status,400);
});

test('Cloudflare: exported conversation, locked decision and fictional media restore into independent SQLite and files',async()=>{
 const {req}=await setup();
 await req('/api/messages','a','POST',{body:'Fictional conversation.'});
 const dec=await (await req('/api/decisions','a','POST',{body:'Fictional decision'})).json();
 await req(`/api/decisions/${dec.id}/approve`,'a','POST');
 await req(`/api/decisions/${dec.id}/approve`,'b','POST');
 await req('/api/media','a','POST',png,'image/png');
 const bundle=await (await req('/api/export','b')).json();
 const folder=await mkdtemp(join(tmpdir(),'justelle-cloudflare-poc-'));
 const summary=await restoreArchive(bundle,folder);
 assert.deepEqual(summary,{messages:1,decisions:1,locked:1,files:1});
 assert.equal((await readdir(join(folder,'media'))).length,1);
 // File tampering must cause restore failure.
 bundle.files[0].sha256='a'.repeat(64);
 const corruptDir=await mkdtemp(join(tmpdir(),'justelle-corrupt-'));
 await assert.rejects(()=>restoreArchive(bundle,corruptDir),/checksum/);
});
