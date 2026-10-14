// Creates/uses only disposable fictional identities in the separate qualification project.
// No tokens, credentials, AI text or image bytes are printed.
import {readFile} from 'node:fs/promises';
import {randomUUID,createHash} from 'node:crypto';
import {initializeApp as initializeAdmin,deleteApp as deleteAdmin} from 'firebase-admin/app';
import {getAuth as adminAuth} from 'firebase-admin/auth';
import {getFirestore as adminFirestore} from 'firebase-admin/firestore';
import {getStorage as adminStorage} from 'firebase-admin/storage';
import {initializeApp,deleteApp} from 'firebase/app';
import {getAuth,signInWithEmailAndPassword} from 'firebase/auth';
import {getFirestore,getDoc,doc,terminate,updateDoc} from 'firebase/firestore';
import {firebaseBackend} from '../web/firebase-backend.mjs';
import {protectedMediaTransport} from '../web/protected-media.mjs';
import {qualify} from './qualify.mjs';
import {buildEnvironment} from './deployment-config.mjs';
import {runScheduledBackup} from './scheduled-backup.mjs';
const config=JSON.parse(await readFile(process.argv[2],'utf8'));
const backupConfig=JSON.parse(await readFile(process.argv[3],'utf8'));
const env=buildEnvironment(config);
if(config.mode!=='hosted-fictional'||config.roomId!=='fictional-room'||config.origin==='https://app.justelle.life')throw Error('Only fictional qualification is permitted');
if(config.members?.length!==2||!config.outsider||!config.aiPricing)throw Error('Private qualification configuration is incomplete');
const admin=initializeAdmin({projectId:config.projectId,storageBucket:env.VITE_FIREBASE_STORAGE_BUCKET});
const auth=adminAuth(admin),db=adminFirestore(admin),bucket=adminStorage(admin).bucket();
const clientApps=[],clientDBs=[];
const results=[];
function assert(condition){if(!condition)throw Error('Hosted fictional acceptance failed');}
async function denial(promise){try{await promise;}catch{return;}throw Error('An unauthorised operation succeeded');}
async function http(path,{method='GET',token,body,contentType}={},expected=[200]){
  const result=await fetch(config.origin+path,{method,redirect:'error',cache:'no-store',signal:AbortSignal.timeout(115000),
    headers:{...(token?{Authorization:'Bearer '+token}:{}),...(contentType?{'Content-Type':contentType}:{})},body});
  assert(expected.includes(result.status));return result;
}
try{
  const fixtures=[...config.members.map((m,i)=>({...m,uid:'fictional-'+(i?'b':'a')})),{...config.outsider,uid:'fictional-outsider'}];
  for(const f of fixtures){
    try{const existing=await auth.getUser(f.uid);assert(existing.email===f.email);}
    catch(e){if(e.code!=='auth/user-not-found')throw e;await auth.createUser({uid:f.uid,email:f.email,password:f.password,emailVerified:true});}
    await auth.setCustomUserClaims(f.uid,{justelle_member:f.uid!=='fictional-outsider',justelle_room:'fictional-room'});
  }
  const membership={uids:['fictional-a','fictional-b'],people:{'fictional-a':'person-a','fictional-b':'person-b'},
    labels:{'fictional-a':'Fictional A','fictional-b':'Fictional B'},revoked_auth_before:{}};
  await db.doc('rooms/fictional-room').set(membership);
  // The real approved provider must qualify here too; deterministic replies do not pass this launch test.
  await db.doc('rooms/fictional-room/operations/runtime').set({ai_enabled:true,ai_provider:'openai-responses',
    ai_model:'gpt-5.6-luna',ai_pricing:config.aiPricing});
  const clients=[];
  for(let i=0;i<fixtures.length;i++){
    const app=initializeApp({apiKey:config.apiKey,projectId:config.projectId,authDomain:env.VITE_FIREBASE_AUTH_DOMAIN},'fictional-'+i);
    clientApps.push(app);const authClient=getAuth(app),clientDB=getFirestore(app);clientDBs.push(clientDB);
    const user=(await signInWithEmailAndPassword(authClient,fixtures[i].email,fixtures[i].password)).user;
    const backend=firebaseBackend({db:clientDB,storage:null,roomId:'fictional-room',membership,
      mediaTransport:protectedMediaTransport({baseUrl:config.origin+'/api/media',getToken:()=>user.getIdToken()})});
    clients.push({user,db:clientDB,backend,token:await user.getIdToken()});
  }
  const [A,B,X]=clients;
  const original=await A.backend.addMessage(A.user,{body:'A fictional museum plan, contributed by member A.'});
  const second=await B.backend.addMessage(B.user,{body:'Member B contributes independently.'});
  assert((await B.backend.messageById(original)).author_id==='person-a');
  assert((await A.backend.messageById(second)).author_id==='person-b');results.push('two_member_interaction');
  const correction=await A.backend.addMessage(A.user,{body:'A fictional correction.',correctsId:original});
  assert((await B.backend.messageById(correction)).corrects_id===original);assert((await A.backend.messageById(original)).body.startsWith('A fictional'));results.push('preserved_correction');
  const bytes=await readFile(new URL('../tests/fictional-landscape.png',import.meta.url));
  const checksum=createHash('sha256').update(bytes).digest('hex'),imageId=randomUUID(),path='rooms/fictional-room/media/'+imageId;
  await http('/api/media/'+imageId+'/original',{method:'PUT',token:A.token,body:bytes,contentType:'image/png'},[201]);
  await http('/api/media/'+imageId+'/original',{method:'PUT',token:A.token,body:bytes,contentType:'image/png'},[409]);
  const full=await http('/api/media/'+imageId+'/original',{token:B.token});assert(Buffer.from(await full.arrayBuffer()).equals(bytes));
  const [stored]=await bucket.file(path).getMetadata();assert(!stored.metadata?.firebaseStorageDownloadTokens);
  const {setDoc,serverTimestamp}=await import('firebase/firestore');
  await setDoc(doc(A.db,'rooms/fictional-room/attachments/'+imageId),{id:imageId,author_uid:A.user.uid,author_id:'person-a',
    name:'synthetic.png',mime:'image/png',size:bytes.length,sha256:checksum,original_path:path,preview_path:null,created_at:serverTimestamp()});
  const source=await A.backend.addMessage(A.user,{body:'Describe what is visible in this synthetic image, then suggest a fictional plan. Label uncertainty.',attachmentIds:[imageId]});
  const ai=await http('/api/respond',{method:'POST',token:A.token,contentType:'application/json',body:JSON.stringify({source_message_id:source})});
  const answer=await ai.json();assert(answer.message_id==='ai-'+source);
  const generated=(await db.doc('rooms/fictional-room/messages/'+answer.message_id).get()).data();assert(generated.kind==='ai'&&generated.author_id==='ai-justelle'&&generated.body.length>0);
  const replay=await http('/api/respond',{method:'POST',token:B.token,contentType:'application/json',body:JSON.stringify({source_message_id:source})});assert((await replay.json()).replayed===true);results.push('protected_images_immutable_retry_and_live_vision');
  const plan=await A.backend.propose(A.user,{body:'A fictional museum visit.',sourceMessageId:source});
  await A.backend.approve(A.user,plan);assert((await getDoc(doc(B.db,'rooms/fictional-room/decisions/'+plan))).data().status==='proposed');
  await B.backend.approve(B.user,plan);assert((await getDoc(doc(A.db,'rooms/fictional-room/decisions/'+plan))).data().status==='locked');
  await denial(updateDoc(doc(A.db,'rooms/fictional-room/decisions/'+plan),{body:'Silently overwritten'}));
  const r1=await A.backend.propose(A.user,{body:'Fictional revision one.',replacesId:plan});
  const r2=await B.backend.propose(B.user,{body:'Fictional revision two.',replacesId:plan});
  await A.backend.approve(A.user,r1);await A.backend.approve(A.user,r2);
  const races=await Promise.allSettled([B.backend.approve(B.user,r1),B.backend.approve(B.user,r2)]);assert(races.filter(r=>r.status==='fulfilled').length===1);results.push('agreement_integrity');
  await denial(X.backend.messageById(original));
  for(const token of [undefined,X.token]){
    await http('/api/media/'+imageId+'/original',{token},[401,403]);
    await http('/api/respond',{method:'POST',token,contentType:'application/json',body:JSON.stringify({source_message_id:source})},[401,403]);
  }
  // Fence the old token in Rules and revoke refresh sessions; keep both canonical authors in memory.
  const fenced={...membership,revoked_auth_before:{'fictional-b':Math.floor(Date.now()/1000)}};
  await db.doc('rooms/fictional-room').set(fenced);await auth.revokeRefreshTokens('fictional-b');
  await qualify({origin:config.origin,room_id:'fictional-room',project_id:config.projectId,bucket:env.VITE_FIREBASE_STORAGE_BUCKET,
    record_id:original,image_id:imageId,member_token:A.token,outsider_token:X.token,revoked_token:B.token});
  await http('/api/respond',{method:'POST',token:B.token,contentType:'application/json',body:JSON.stringify({source_message_id:source})},[401]);results.push('outsider_direct_file_and_revoked_session_denial');
  await db.doc('rooms/fictional-room/operations/runtime').set({ai_enabled:false});
  const failureSource=await A.backend.addMessage(A.user,{body:'Fictional failure test.'});
  await http('/api/respond',{method:'POST',token:A.token,contentType:'application/json',body:JSON.stringify({source_message_id:failureSource})},[503]);
  assert((await A.backend.messageById(failureSource)).body==='Fictional failure test.');results.push('ai_disabled_failure_preserves_message');
  const backup=await runScheduledBackup({db,bucket,roomId:'fictional-room',config:backupConfig});assert(backup.verified);results.push('encrypted_b2_download_and_independent_restore');
  console.log(JSON.stringify({hosted_fictional_acceptance:'passed',checks:results}));
}finally{
  await db.doc('rooms/fictional-room/operations/runtime').set({ai_enabled:false}).catch(()=>{});
  for(const client of clientDBs)await terminate(client);
  for(const app of clientApps)await deleteApp(app);
  await db.terminate();await deleteAdmin(admin);
}
