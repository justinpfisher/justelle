import {test} from 'node:test';
import assert from 'node:assert/strict';
import {resolveRuntime} from '../web/runtime-config.mjs';
import {protectedMediaTransport} from '../web/protected-media.mjs';
import {buildEnvironment} from '../hosting/deployment-config.mjs';
const env={VITE_JUSTELLE_MODE:'hosted-fictional',VITE_JUSTELLE_ORIGIN:'https://fictional-qualification.web.app',VITE_FIREBASE_PROJECT_ID:'fictional-qualification',VITE_FIREBASE_API_KEY:'fictional-public-config',VITE_FIREBASE_AUTH_DOMAIN:'fictional-qualification.firebaseapp.com',VITE_FIREBASE_STORAGE_BUCKET:'fictional-qualification.firebasestorage.app',VITE_JUSTELLE_ROOM:'fictional-room'};
test('Deployment configuration pins each mode to its dedicated Justelle project pair and qualification site',()=>{
  const qualification={mode:'hosted-fictional',projectId:'justelle-qualification',otherProjectId:'justelle-production',
    site:'justelle-qualification',origin:'https://justelle-qualification.web.app',roomId:'fictional-room',apiKey:'synthetic-public-key',
    gatewayServiceAccount:'gateway@justelle-qualification.iam.gserviceaccount.com',
    backupServiceAccount:'backup@justelle-qualification.iam.gserviceaccount.com'};
  assert.equal(buildEnvironment(qualification).VITE_FIREBASE_PROJECT_ID,'justelle-qualification');
  assert.throws(()=>buildEnvironment({...qualification,projectId:'justelle-production',otherProjectId:'justelle-qualification'}),/dedicated Justelle project pair/);
  assert.throws(()=>buildEnvironment({...qualification,otherProjectId:'another-project'}),/dedicated Justelle project pair/);
  assert.throws(()=>buildEnvironment({...qualification,site:'justelle-private-production'}),/isolated qualification Hosting site/);
  assert.throws(()=>buildEnvironment({...qualification,origin:'https://app.justelle.life'}),/isolated qualification Hosting site/);
  const production={...qualification,mode:'production',projectId:'justelle-production',otherProjectId:'justelle-qualification',
    site:'private-production-site',origin:'https://app.justelle.life',roomId:'fictional-production-room',
    gatewayServiceAccount:'gateway@justelle-production.iam.gserviceaccount.com',
    backupServiceAccount:'backup@justelle-production.iam.gserviceaccount.com'};
  assert.equal(buildEnvironment(production).VITE_FIREBASE_PROJECT_ID,'justelle-production');
  assert.throws(()=>buildEnvironment({...production,projectId:'justelle-qualification',otherProjectId:'justelle-production'}),/dedicated Justelle project pair/);
});
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
const plannerHtml='<html lang="en-CA"><head><link rel="apple-touch-icon" href="/justelle-caricature.png"></head>'+
  '<body><form id="login-form"></form><div id="private-app">'+
  '<form id="planner-create"></form></div></body></html>';
const privateHeaders={'Cache-Control':'no-store',
  'Content-Security-Policy':"default-src 'self'; frame-ancestors 'none'; object-src 'none'"};
const homeManifest={name:'Justelle. Still us.',start_url:'/',scope:'/',
  display:'standalone',icons:[{src:'/justelle-caricature.png',type:'image/png',sizes:'any'}]};

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
    if(pathname==='/')return new Response(plannerHtml,{headers:privateHeaders});
    if(pathname==='/manifest.webmanifest')return Response.json(homeManifest);
    if(pathname==='/justelle-caricature.png')return new Response('synthetic-image');
    if(pathname.startsWith('/v1/accounts:signInWithPassword')){
      const input=JSON.parse(options.body);
      assert.ok(members.some(m=>m.email===input.email));
      return Response.json({idToken:'fictional-'+input.email,localId:'uid-'+input.email,
        refreshToken:'never-printed'});
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
   if(path==='/')return new Response(plannerHtml,{headers:privateHeaders});
   if(path==='/manifest.webmanifest')return Response.json(homeManifest);
   if(path==='/justelle-caricature.png')return new Response('synthetic-image');
   if(path.startsWith('/api/media/')||path==='/api/respond'&&!options.headers?.Authorization||
      path==='/api/plan/suggest'&&!options.headers?.Authorization)
     return new Response('Anonymous denied',{status:401});
   if(path==='/v1/accounts:signInWithPassword')return Response.json({idToken:'fictional-'+(++login),localId:'fictional-uid-'+login});
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

test('A public landing page, missing privacy headers or bad PWA manifest block release',async()=>{
 const origin='https://app.justelle.life',sha='a'.repeat(40);
 const cases=[
   {html:'<html><h1>Justelle. Still us.</h1></html>',headers:privateHeaders,manifest:homeManifest,
      expected:/Private planner HTML/},
   {html:plannerHtml,headers:{},manifest:homeManifest,
      expected:/security headers/},
   {html:plannerHtml,headers:privateHeaders,manifest:{...homeManifest,display:'browser'},
      expected:/Home Screen manifest/}
 ];
 for(const entry of cases){
   let calls=0;
   const fakeFetch=async uri=>{
     calls++;
     const path=new URL(uri).pathname;
     if(path==='/api/healthz')return Response.json({version:sha});
     if(path==='/')return new Response(entry.html,{headers:entry.headers});
     if(path==='/manifest.webmanifest')return Response.json(entry.manifest);
     throw Error('Incorrectly reached member authentication after invalid private site');
   };
   await assert.rejects(smoke({origin,projectId:'fictional-project',roomId:'fictional-room',
     apiKey:'fictional-key',members:[{email:'first@example.invalid'},
       {email:'second@example.invalid'}],sha},fakeFetch),entry.expected);
   assert.ok(calls<=3,'Invalid shell must fail before member credentials are used');
 }
});

test('Before JavaScript starts, private sign-in is neutral and pilot warnings are hidden',async()=>{
 const {readFile}=await import('node:fs/promises');
 const html=await readFile(new URL('../web/index.html',import.meta.url),'utf8');
 assert.match(html,/class="pilot" role="note" hidden/);
 assert.match(html,/Sign in to your private Justelle space/);
 assert.match(html,/<label for="email">Email<\/label>/);
 assert.match(html,/<label for="password">Password<\/label>/);
 assert.ok(!html.includes('Test email'));
 assert.ok(!html.includes('This prototype is not authorised for personal content'));
 assert.ok(html.includes('id="planner-create"'));
});

import {syntheticVisionPng,visionColourAnswer} from '../hosting/fictional-vision-probe.mjs';
import {inflateSync} from 'node:zlib';
test('Hosted fictional vision probes are valid distinct PNGs with no embedded answer metadata',()=>{
 const a=syntheticVisionPng('red'),b=syntheticVisionPng('blue');
 for(const [colour,bytes] of [['red',a],['blue',b]]){
   assert.equal(bytes.subarray(0,8).toString('hex'),'89504e470d0a1a0a');
   assert.equal(bytes.readUInt32BE(16),24);
   assert.equal(bytes.readUInt32BE(20),24);
   assert.equal(bytes[25],2,'RGB PNG, not an SVG or referenced remote image');
   const idatLength=bytes.readUInt32BE(33);
   assert.equal(bytes.toString('ascii',37,41),'IDAT');
   const raw=inflateSync(bytes.subarray(41,41+idatLength));
   assert.equal(raw.length,24*(1+24*3));
   for(let y=0;y<24;y++){
     assert.equal(raw[y*(1+24*3)],0);
     for(let x=0;x<24;x++){
       const at=y*(1+24*3)+1+x*3;
       assert.deepEqual([...raw.subarray(at,at+3)],
         colour==='red'?[255,0,0]:[0,0,255]);
     }
   }
   assert.ok(!bytes.includes(Buffer.from('red'))&&!bytes.includes(Buffer.from('blue')),
     'The answer is encoded only as coloured pixels, not visible text');
 }
 assert.notDeepEqual(a,b);
 assert.throws(()=>syntheticVisionPng('real-photo'),/fictional/);
});
test('Live vision must identify the correct colour, not merely clarify or echo choices',()=>{
 assert.equal(visionColourAnswer('red','red'),true);
 assert.equal(visionColourAnswer('The main colour is blue.','blue'),true);
 for(const [reply,expected] of [
   ['This might be red or blue','red'],
   ['Not sure','blue'],['blue','red'],['red and blue','blue'],
   ['','red'],['The image contains a square','red'],
   ['red','green']
 ])assert.equal(visionColourAnswer(reply,expected),false);
});

test('Production smoke rejects duplicate configured member emails before sign-in',async()=>{
 const members=[{email:'one@example.invalid',password:'secret-one'},
   {email:' ONE@example.invalid ',password:'secret-two'}];
 const sha='a'.repeat(40),origin='https://app.justelle.life';
 let attemptedLogin=false;
 const fetchImpl=async(url)=>{
   const path=new URL(url).pathname;
   if(path==='/api/healthz')return Response.json({version:sha});
   if(path==='/')return new Response(plannerHtml,{headers:privateHeaders});
   if(path==='/manifest.webmanifest')return Response.json(homeManifest);
   if(path==='/justelle-caricature.png')return new Response('fictional-image');
   if(path.startsWith('/api/media/')||path==='/api/respond'||path==='/api/plan/suggest')
     return new Response('Sign-in required',{status:401});
   if(path==='/v1/accounts:signInWithPassword')attemptedLogin=true;
   throw Error('Unexpected login or request');
 };
 await assert.rejects(smoke({origin,projectId:'fictional-production',roomId:'shared-life',
   apiKey:'synthetic-api-key',members,sha},fetchImpl),/distinct private member/);
 assert.equal(attemptedLogin,false);
});

test('Production smoke refuses two different email logins resolving to the same Firebase UID',async()=>{
 const members=[{email:'one@example.invalid',password:'synthetic-one'},
   {email:'two@example.invalid',password:'synthetic-two'}];
 const sha='a'.repeat(40),origin='https://app.justelle.life';
 let logins=0,successfulMemberReads=0;
 const fakeFetch=async(url,options)=>{
   const path=new URL(url).pathname;
   if(path==='/api/healthz')return Response.json({version:sha});
   if(path==='/')return new Response(plannerHtml,{headers:privateHeaders});
   if(path==='/manifest.webmanifest')return Response.json(homeManifest);
   if(path==='/justelle-caricature.png')return new Response('fictional-image');
   if(path==='/v1/accounts:signInWithPassword'){
     logins++;
     return Response.json({idToken:'synthetic-id-token',localId:'same-uid',
       refreshToken:'synthetic-refresh-token'});
   }
   if(path.startsWith('/v1/projects/')){
     successfulMemberReads++;
     return Response.json({});
   }
   if(path.startsWith('/api/media/'))return new Response('',{status:401});
   if(path==='/api/respond'||path==='/api/plan/suggest')
     return new Response('',{status:options.headers?.Authorization?404:401});
   throw Error('Unexpected synthetic smoke request');
 };
 await assert.rejects(smoke({origin,projectId:'fictional-production',roomId:'shared-life',
   apiKey:'synthetic-api-key',members,sha},fakeFetch),/distinct authenticated Firebase member UIDs/);
 assert.equal(logins,2);
 assert.equal(successfulMemberReads,2); // second login denied before any member data access
});
