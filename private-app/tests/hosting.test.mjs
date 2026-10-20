import {test} from 'node:test';
import assert from 'node:assert/strict';
import {resolveRuntime} from '../web/runtime-config.mjs';
import {protectedMediaTransport} from '../web/protected-media.mjs';
const env={VITE_JUSTELLE_MODE:'hosted-fictional',VITE_JUSTELLE_ORIGIN:'https://fictional-qualification.web.app',VITE_FIREBASE_PROJECT_ID:'fictional-qualification',VITE_FIREBASE_API_KEY:'fictional-public-config',VITE_FIREBASE_AUTH_DOMAIN:'fictional-qualification.firebaseapp.com',VITE_FIREBASE_STORAGE_BUCKET:'fictional-qualification.firebasestorage.app',VITE_JUSTELLE_ROOM:'fictional-room'};
test('Hosted bootstrap requires an explicit isolated fictional project and HTTPS origin',()=>{
  assert.throws(()=>resolveRuntime({hostname:'fictional-qualification.web.app',origin:env.VITE_JUSTELLE_ORIGIN}),/locally/);
  assert.throws(()=>resolveRuntime({hostname:'justelle.life',origin:'https://justelle.life',env}),/origin/);
  assert.throws(()=>resolveRuntime({origin:env.VITE_JUSTELLE_ORIGIN,env:{...env,VITE_JUSTELLE_ROOM:'real-room'}}),/fictional/);
  const result=resolveRuntime({hostname:'fictional-qualification.web.app',origin:env.VITE_JUSTELLE_ORIGIN,env});
  assert.equal(result.mediaUrl,env.VITE_JUSTELLE_ORIGIN+'/api/media');
  assert.equal(result.mode,'hosted-fictional');
});
test('Hosted image transport authenticates every read, refuses redirects and bounds returned bytes',async()=>{
  const calls=[];let bytes=Uint8Array.from([1,2,3]);
  const transport=protectedMediaTransport({baseUrl:env.VITE_JUSTELLE_ORIGIN+'/api/media',getToken:async()=>'fictional-token',fetchImpl:async(url,options)=>{calls.push({url,options});return new Response(bytes);}});
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

test('Production uses its own project, protected routes and only the approved app hostname',()=>{
  const production={...env,VITE_JUSTELLE_MODE:'production',VITE_JUSTELLE_ORIGIN:'https://app.justelle.life',
    VITE_FIREBASE_PROJECT_ID:'fictional-production',VITE_FIREBASE_AUTH_DOMAIN:'fictional-production.firebaseapp.com',
    VITE_FIREBASE_STORAGE_BUCKET:'fictional-production.firebasestorage.app',VITE_JUSTELLE_ROOM:'shared-life',
    VITE_JUSTELLE_QUALIFICATION_PROJECT_ID:'fictional-qualification'};
  const load=e=>resolveRuntime({origin:e.VITE_JUSTELLE_ORIGIN,env:e});
  assert.equal(load(production).aiUrl,'https://app.justelle.life/api/respond');
  for(const wrong of [{...production,VITE_JUSTELLE_ROOM:'fictional-room'},
    {...production,VITE_JUSTELLE_QUALIFICATION_PROJECT_ID:'fictional-production'},
    {...production,VITE_JUSTELLE_ORIGIN:'https://justelle.life'},
    {...production,VITE_JUSTELLE_ORIGIN:'https://fictional-production.web.app'}])assert.throws(()=>load(wrong));
});

import {smoke} from '../hosting/smoke.mjs';
test('Production smoke covers both member planner reads, unauthenticated originals and no-cost source-missing AI paths',async()=>{
  const sha='a'.repeat(40),origin='https://app.justelle.life';
  const members=[{email:'fictional-a@example.invalid',password:'fictional-a-secret'},
    {email:'fictional-b@example.invalid',password:'fictional-b-secret'}];
  const calls=[];
  async function fakeFetch(uri,options){
    const url=new URL(uri),pathname=url.pathname;
    const method=options.method||'GET',token=options.headers?.Authorization;
    calls.push({pathname,method,authorized:Boolean(token)});
    if(pathname==='/api/healthz')return Response.json({version:sha});
    if(['/','/manifest.webmanifest','/justelle-caricature.png'].includes(pathname))
      return new Response('fictional-content',{status:200});
    if(pathname.startsWith('/v1/accounts:signInWithPassword')){
      const input=JSON.parse(options.body);
      assert.ok(members.some(m=>m.email===input.email));
      return Response.json({idToken:'fictional-'+input.email,refreshToken:'never-printed'});
    }
    if(pathname.startsWith('/v1/projects/')){
      assert.match(token,/^Bearer fictional-/);
      assert.ok(pathname.endsWith('/rooms/fictional-room')||
        pathname.endsWith('/rooms/fictional-room/adventure_plans'));
      return Response.json({documents:[]});
    }
    if(pathname==='/api/respond'||pathname==='/api/plan/suggest'){
      assert.equal(method,'POST');
      if(!token)return new Response('Sign-in required',{status:401});
      const body=JSON.parse(options.body);
      if(pathname.endsWith('/plan/suggest')){
        assert.equal(body.revision,0);
        assert.equal(typeof body.source_id,'string');
        assert.equal(typeof body.plan_id,'string');
        return new Response('Adventure not found',{status:404});
      }
      assert.equal(typeof body.source_message_id,'string');
      return new Response('Message not found',{status:404});
    }
    if(pathname.startsWith('/api/media/')){
      assert.equal(token,undefined);
      return new Response('Sign-in required',{status:401});
    }
    throw Error('Unexpected smoke request: '+pathname);
  }
  await smoke({origin,projectId:'fictional-project',roomId:'fictional-room',
    apiKey:'fictional-public-key',members,sha},fakeFetch);
  assert.equal(calls.filter(x=>x.pathname.endsWith('/adventure_plans')&&x.authorized).length,2);
  assert.equal(calls.filter(x=>x.pathname==='/api/plan/suggest'&&x.authorized).length,2);
  assert.equal(calls.filter(x=>x.pathname==='/api/media/documents/00000000-0000-4000-8000-000000000001'&&!x.authorized).length,1);
  assert.equal(calls.filter(x=>x.pathname==='/api/plan/suggest'&&!x.authorized).length,1);
});
test('Production smoke fails closed when the signed planner API is absent',async()=>{
 const origin='https://app.justelle.life';
 let login=0;
 const fetchImpl=async(uri,options)=>{
   const path=new URL(uri).pathname;
   if(path==='/api/healthz')return Response.json({version:'a'.repeat(40)});
   if(['/','/manifest.webmanifest','/justelle-caricature.png'].includes(path))
     return new Response('ok',{status:200});
   if(path.startsWith('/api/media/')||path==='/api/respond'&&!options.headers?.Authorization||
      path==='/api/plan/suggest'&&!options.headers?.Authorization)
     return new Response('Anonymous denied',{status:401});
   if(path==='/v1/accounts:signInWithPassword')return Response.json({idToken:'fictional-'+(++login)});
   if(path.startsWith('/v1/projects/'))return Response.json({});
   if(path==='/api/respond')return new Response('Missing message',{status:404});
   if(path==='/api/plan/suggest')return new Response('Missing planner route',{status:503});
   throw Error('Unexpected mock URL');
 };
 await assert.rejects(smoke({origin,projectId:'fictional-project',roomId:'fictional-room',
   apiKey:'fictional-key',members:[{email:'a@example.invalid',password:'a'},
     {email:'b@example.invalid',password:'b'}],sha:'a'.repeat(40)},fetchImpl),
 /Release access check failed/);
});
