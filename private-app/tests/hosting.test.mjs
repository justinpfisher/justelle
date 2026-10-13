import {test} from 'node:test';
import assert from 'node:assert/strict';
import {resolveRuntime} from '../web/runtime-config.mjs';
import {protectedMediaTransport} from '../web/protected-media.mjs';
const env={VITE_JUSTELLE_MODE:'hosted-fictional',VITE_JUSTELLE_ORIGIN:'https://app.justelle.life',VITE_FIREBASE_PROJECT_ID:'fictional-qualification',VITE_FIREBASE_API_KEY:'fictional-public-config',VITE_FIREBASE_AUTH_DOMAIN:'fictional-qualification.firebaseapp.com',VITE_FIREBASE_STORAGE_BUCKET:'fictional-qualification.firebasestorage.app',VITE_JUSTELLE_ROOM:'fictional-room'};
test('Hosted bootstrap requires an explicit isolated fictional project and HTTPS origin',()=>{
  assert.throws(()=>resolveRuntime({hostname:'app.justelle.life',origin:env.VITE_JUSTELLE_ORIGIN}),/locally/);
  assert.throws(()=>resolveRuntime({hostname:'justelle.life',origin:'https://justelle.life',env}),/origin/);
  assert.throws(()=>resolveRuntime({origin:env.VITE_JUSTELLE_ORIGIN,env:{...env,VITE_JUSTELLE_ROOM:'real-room'}}),/fictional/);
  const result=resolveRuntime({hostname:'app.justelle.life',origin:env.VITE_JUSTELLE_ORIGIN,env});
  assert.equal(result.mediaUrl,'https://app.justelle.life/api/media');
  assert.equal(result.mode,'hosted-fictional');
});
test('Hosted image transport authenticates every read, refuses redirects and bounds returned bytes',async()=>{
  const calls=[];let bytes=Uint8Array.from([1,2,3]);
  const transport=protectedMediaTransport({baseUrl:'https://app.justelle.life/api/media',getToken:async()=>'fictional-token',fetchImpl:async(url,options)=>{calls.push({url,options});return new Response(bytes);}});
  const id='00000000-0000-4000-8000-000000000001';
  assert.deepEqual(await transport.read('rooms/fictional-room/media/'+id,3),bytes);
  assert.equal(calls[0].options.headers.Authorization,'Bearer fictional-token');assert.equal(calls[0].options.redirect,'error');assert.equal(calls[0].options.cache,'no-store');
  await assert.rejects(transport.read('rooms/fictional-room/media/'+id,2),/size/);
  await assert.rejects(transport.read('https://unapproved.invalid/image',12),/reference/);
});

import {approvedMember,createMediaHandler} from '../hosting/media-handler.mjs';
import {Readable} from 'node:stream';
const member={uid:'fictional-a',justelle_member:true,justelle_room:'fictional-room'};
const membership={uids:['fictional-a','fictional-b'],people:{'fictional-a':'person-a','fictional-b':'person-b'}};
const deps={roomId:'fictional-room',verifyIdentity:async()=>member,readMembership:async()=>membership};
test('Hosted identity checks revocation and current membership on every media request',async()=>{
  let options;await approvedMember('fictional-token',{...deps,verifyIdentity:async(t,o)=>{options=o;return member;}});
  assert.equal(options.checkRevoked,true);
  await assert.rejects(approvedMember(null,deps),e=>e.status===401);
  await assert.rejects(approvedMember('token',{...deps,readMembership:async()=>({uids:['fictional-b'],people:{}})}),e=>e.status===403);
  await assert.rejects(approvedMember('token',{...deps,verifyIdentity:async()=>({...member,uid:'outsider'})}),e=>e.status===403);
});
function response(){return {headersSent:false,headers:null,status:null,body:'',writeHead(s,h){this.status=s;this.headers=h;this.headersSent=true;},end(b=''){this.body+=b;},write(b){this.body+=b;return true;},destroy(){this.destroyed=true;}};}
test('Hosted upload uses immutable token-free GCS writes and refuses token-bearing objects',async()=>{
  const id='00000000-0000-4000-8000-000000000001';let saved;let token=false;
  const file={save:async(bytes,options)=>{saved={bytes,options};},getMetadata:async()=>[{contentType:'image/png',size:3,metadata:{attachment_id:id,role:'original',...(token?{firebaseStorageDownloadTokens:'forbidden'}:{})}}],createReadStream:()=>Readable.from([Buffer.from('png')])};
  const handler=createMediaHandler({...deps,bucket:{file:()=>file}});
  const req=Readable.from([Buffer.from('png')]);Object.assign(req,{url:'/api/media/'+id+'/original',method:'PUT',headers:{authorization:'Bearer fictional-token','content-type':'image/png'}});
  const res=response();await handler(req,res);assert.equal(res.status,201);assert.equal(saved.options.preconditionOpts.ifGenerationMatch,0);assert.equal(saved.options.metadata.metadata.firebaseStorageDownloadTokens,undefined);
  const read={url:req.url,method:'GET',headers:{authorization:'Bearer fictional-token'}};
  const good=response();await handler(read,good);assert.equal(good.status,200);assert.equal(good.headers['Cache-Control'],'private, no-store');assert.equal(good.body,'png');
  token=true;const bad=response();await handler(read,bad);assert.equal(bad.status,503);
});
