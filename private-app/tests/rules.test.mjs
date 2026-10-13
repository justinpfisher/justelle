import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {initializeTestEnvironment,assertFails,assertSucceeds} from '@firebase/rules-unit-testing';
import {doc,collection,getDoc,getDocs,setDoc,updateDoc,writeBatch,serverTimestamp} from 'firebase/firestore';
import {ref,uploadBytes,getBytes} from 'firebase/storage';
import {firebaseBackend} from '../web/firebase-backend.mjs';
import {sha256} from '../web/media.mjs';

const projectId='demo-justelle-pilot',room='fictional-room',a='fictional-a',b='fictional-b';
const imageId='00000000-0000-4000-8000-000000000001';
const png=new Uint8Array(await readFile(new URL('./fictional-landscape.png',import.meta.url)));
const membership={uids:[a,b],people:{[a]:'person-a',[b]:'person-b'},labels:{[a]:'Fictional A',[b]:'Fictional B'}};
async function context() {
  const env=await initializeTestEnvironment({
    projectId,
    firestore:{host:'127.0.0.1',port:8081,rules:await readFile(new URL('../firebase/firestore.rules',import.meta.url),'utf8')},
    storage:{host:'127.0.0.1',port:9199,rules:await readFile(new URL('../firebase/storage.rules',import.meta.url),'utf8')}
  });
  await env.clearFirestore();await env.clearStorage();
  await env.withSecurityRulesDisabled(async c=>setDoc(doc(c.firestore(),'rooms',room),membership));
  const user=uid=>env.authenticatedContext(uid,{justelle_room:room,justelle_member:true});
  return {env,A:user(a),B:user(b),X:user('outsider'),U:env.unauthenticatedContext(),noClaim:env.authenticatedContext(a)};
}
const message=(ctx,id)=>doc(ctx.firestore(),'rooms',room,'messages',id);
const decision=(ctx,id)=>doc(ctx.firestore(),'rooms',room,'decisions',id);
const adventure=(ctx,id)=>doc(ctx.firestore(),'rooms',room,'adventures',id);
const att=(ctx,id)=>doc(ctx.firestore(),'rooms',room,'attachments',id);
const media=(ctx,id=imageId)=>ref(ctx.storage('gs://'+projectId+'.firebasestorage.app'),'rooms/'+room+'/media/'+id);
function messageData(uid=a,ids=[]) {
  return {body:'Fictional coastal idea',author_uid:uid,author_id:uid===a?'person-a':'person-b',
    kind:'person',conversation_id:'conversation-shared',adventure_id:null,attachment_ids:ids,created_at:serverTimestamp()};
}
function proposalData(uid=a,replaces=null) {
  return {body:'Fictional museum visit',why:'Testing agreement',author_uid:uid,author_id:uid===a?'person-a':'person-b',
    origin:'human',conversation_id:'conversation-shared',adventure_id:null,source_message_id:null,replaces_id:replaces,
    status:'proposed',approvals:{},approval_times:{},created_at:serverTimestamp(),locked_at:null,declined_by:null,declined_at:null};
}
function ideaData(uid=a) {
  return {id:'idea-1',title:'Fictional garden',phase:'idea',phases:['idea'],author_uid:uid,
    author_id:uid===a?'person-a':'person-b',last_modified_by:'person-a',conversation_id:'conversation-idea-1',
    source_message_id:null,created_at:serverTimestamp(),updated_at:serverTimestamp()};
}
async function createIdea(ctx,phase='idea') {
  const batch=writeBatch(ctx.firestore());
  batch.set(adventure(ctx,'idea-1'),{...ideaData(),phase,phases:[phase],last_event_id:'event-initial'});
  batch.set(doc(ctx.firestore(),'rooms',room,'adventure_events','event-initial'),{
    adventure_id:'idea-1',phase,previous_id:null,author_uid:a,author_id:'person-a',created_at:serverTimestamp()
  });
  await assertSucceeds(batch.commit());
}
test('Two authorised members share immutable messages; outsiders, unauthenticated clients and forged authors fail',async()=>{
  const {env,A,B,X,U,noClaim}=await context();
  try {
    await assertSucceeds(setDoc(message(A,'message-1'),messageData()));
    await assertSucceeds(setDoc(message(B,'message-2'),messageData(b)));
    assert.equal((await getDocs(collection(B.firestore(),'rooms',room,'messages'))).size,2);
    await assertFails(getDocs(collection(X.firestore(),'rooms',room,'messages')));
    await assertFails(getDoc(message(U,'message-1')));
    await assertFails(getDoc(message(noClaim,'message-1')));
    await assertFails(setDoc(message(A,'fake-author'),messageData(b)));
    await assertFails(setDoc(message(A,'fake-ai'),{...messageData(),kind:'ai'}));
    await assertFails(updateDoc(message(A,'message-1'),{body:'Erase history'}));
  }finally{await env.cleanup();}
});
test('Original images are read by members only; cross-user overwrite, direct reads and wrong MIME fail',async()=>{
  const {env,A,B,X,U}=await context();
  try {
    const metadata={contentType:'image/png',customMetadata:{author_uid:a,attachment_id:imageId,role:'original'}};
    await assertSucceeds(uploadBytes(media(A),png,metadata));
    assert.deepEqual(Buffer.from(await getBytes(media(B))),Buffer.from(png));
    await assertFails(getBytes(media(X)));
    await assertFails(getBytes(media(U)));
    await assertFails(uploadBytes(media(B),png,{...metadata,customMetadata:{...metadata.customMetadata,author_uid:b}}));
    await assertFails(uploadBytes(media(A,'not-image.txt'),png,{contentType:'text/plain',customMetadata:metadata.customMetadata}));
    const digest=await sha256(png);
    const meta={id:imageId,author_uid:a,author_id:'person-a',name:'fictional-landscape.png',
      mime:'image/png',size:png.length,sha256:digest,original_path:'rooms/'+room+'/media/'+imageId,preview_path:null,created_at:serverTimestamp()};
    await assertSucceeds(setDoc(att(A,imageId),meta));
    assert.equal((await getDoc(att(B,imageId))).data().sha256,digest);
    await assertFails(getDoc(att(X,imageId)));
    await assertFails(setDoc(att(B,'00000000-0000-4000-8000-000000000008'),{...meta,id:'00000000-0000-4000-8000-000000000008'}));
    await assertSucceeds(setDoc(message(A,'message-photo'),messageData(a,[imageId])));
  }finally{await env.cleanup();}
});
test('Simultaneous human approvals lock once, never let a single member lock or change an agreement',async()=>{
  const {env,A,B,X}=await context();
  try {
    await assertSucceeds(setDoc(decision(A,'decision-1'),proposalData()));
    await assertFails(updateDoc(decision(A,'decision-1'),{'status':'locked'}));
    await assertFails(updateDoc(decision(A,'decision-1'),{'approvals.fictional-a':true,'approvals.fictional-b':true,'status':'locked'}));
    await assertFails(updateDoc(decision(X,'decision-1'),{'approvals.outsider':true}));
    const one=firebaseBackend({db:A.firestore(),storage:null,roomId:room,membership});
    const two=firebaseBackend({db:B.firestore(),storage:null,roomId:room,membership});
    const results=await Promise.allSettled([one.approve({uid:a},'decision-1'),two.approve({uid:b},'decision-1')]);
    for(const [index,result] of results.entries()) {
      if(result.status==='rejected') await (index===0?one:two).approve({uid:index===0?a:b},'decision-1');
    }
    const locked=(await getDoc(decision(A,'decision-1'))).data();
    assert.equal(locked.status,'locked');
    assert.deepEqual(Object.keys(locked.approvals).sort(),[a,b]);
    assert.deepEqual(Object.keys(locked.approval_times).sort(),[a,b]);
    assert.ok(locked.locked_at);
    await assertFails(updateDoc(decision(A,'decision-1'),{body:'Silently replace confirmed plan'}));
    await assertFails(updateDoc(decision(B,'decision-1'),{status:'proposed'}));
    await assertSucceeds(setDoc(decision(B,'decision-revision'),proposalData(b,'decision-1')));
    assert.equal((await getDoc(decision(A,'decision-1'))).data().body,'Fictional museum visit');
    assert.equal((await getDoc(decision(A,'decision-revision'))).data().status,'proposed');
  }finally{await env.cleanup();}
});
test('Competing confirmed changes cannot overwrite one another, even when two approvals race',async()=>{
  const {env,A,B,X}=await context();
  try{
    const one=firebaseBackend({db:A.firestore(),storage:null,roomId:room,membership});
    const two=firebaseBackend({db:B.firestore(),storage:null,roomId:room,membership});
    const claim=id=>doc(A.firestore(),'rooms',room,'decision_replacements',id);
    await assertSucceeds(setDoc(decision(A,'original'),proposalData()));
    await one.approve({uid:a},'original');
    await two.approve({uid:b},'original');
    await assertFails(setDoc(claim('original'),{
      replacement_id:'forged-replacement',locked_at:serverTimestamp()
    }));
    await assertSucceeds(setDoc(decision(A,'change-a'),proposalData(a,'original')));
    await assertSucceeds(setDoc(decision(B,'change-b'),proposalData(b,'original')));
    await one.approve({uid:a},'change-a');
    await one.approve({uid:a},'change-b');
    const outcomes=await Promise.allSettled([
      two.approve({uid:b},'change-a'),
      two.approve({uid:b},'change-b')
    ]);
    assert.equal(outcomes.filter(x=>x.status==='fulfilled').length,1);
    assert.equal(outcomes.filter(x=>x.status==='rejected').length,1);
    const aState=(await getDoc(decision(A,'change-a'))).data().status;
    const bState=(await getDoc(decision(A,'change-b'))).data().status;
    assert.deepEqual([aState,bState].sort(),['locked','proposed']);
    const winner=aState==='locked'?'change-a':'change-b';
    const loser=winner==='change-a'?'change-b':'change-a';
    assert.equal((await getDoc(claim('original'))).data().replacement_id,winner);
    assert.equal((await getDoc(decision(A,'original'))).data().status,'locked');
    await assertFails(getDoc(doc(X.firestore(),'rooms',room,'decision_replacements','original')));
    await assertFails(setDoc(claim('original'),{
      replacement_id:loser,locked_at:serverTimestamp()
    }));
    await assertFails(setDoc(decision(A,'late-change'),proposalData(a,'original')));
    await assert.rejects(two.approve({uid:b},loser),/already changed/);
    await assertSucceeds(setDoc(decision(A,'next-change'),proposalData(a,winner)));
    await one.approve({uid:a},'next-change');
    await two.approve({uid:b},'next-change');
    assert.equal((await getDoc(decision(A,'next-change'))).data().status,'locked');
    assert.equal((await getDoc(claim(winner))).data().replacement_id,'next-change');
  }finally{await env.cleanup();}
});
test('Memories can start directly and change direction while retaining attributable immutable history',async()=>{
  const {env,A,B,X}=await context();
  try {
    await createIdea(A,'memory');
    await assertFails(updateDoc(adventure(B,'idea-1'),{phase:'memory',phases:['idea','memory'],updated_at:serverTimestamp(),last_modified_by:'person-b'}));
    const two=firebaseBackend({db:B.firestore(),storage:null,roomId:room,membership});
    for(const next of ['idea','experience','plan','memory']) {
      await two.advance({uid:b},'idea-1',next);
      assert.equal((await getDoc(adventure(A,'idea-1'))).data().phase,next);
    }
    assert.deepEqual((await getDoc(adventure(B,'idea-1'))).data().phases,['memory','idea','experience','plan','memory']);
    await assertFails(updateDoc(adventure(A,'idea-1'),{phase:'idea'}));
    await assertFails(updateDoc(doc(A.firestore(),'rooms',room,'adventure_events','event-initial'),{phase:'plan'}));
    const events=await getDocs(collection(B.firestore(),'rooms',room,'adventure_events'));
    assert.equal(events.size,5);
    assert.equal(events.docs.filter(e=>e.data().author_id==='person-b').length,4);
    await assertFails(getDoc(adventure(X,'idea-1')));
  }finally{await env.cleanup();}
});


test('Adventure discussions stay scoped, old shared chat stays separate and spoofing a topic fails',async()=>{
  const {env,A,B,X,U}=await context();
  try{
    await createIdea(A);
    await assertSucceeds(setDoc(message(A,'topic-message'),{
      ...messageData(),conversation_id:'conversation-idea-1',adventure_id:'idea-1'
    }));
    await assertSucceeds(setDoc(message(B,'general-message'),messageData(b)));
    await assertFails(setDoc(message(A,'wrong-topic'),{
      ...messageData(),conversation_id:'conversation-unrelated',adventure_id:'idea-1'
    }));
    await assertFails(setDoc(message(A,'unbacked-topic'),{
      ...messageData(),conversation_id:'conversation-missing',adventure_id:'missing'
    }));
    const provider=firebaseBackend({db:A.firestore(),storage:null,roomId:room,membership});
    const general=await provider.readPage('conversation-shared');
    const topic=await provider.readPage('conversation-idea-1');
    assert.deepEqual(general.items.map(m=>m.id),['general-message']);
    assert.deepEqual(topic.items.map(m=>m.id),['topic-message']);
    await assertFails(getDoc(message(X,'topic-message')));
    await assertFails(getDoc(message(U,'topic-message')));
    await assertFails(updateDoc(adventure(B,'idea-1'),{conversation_id:'conversation-hijacked'}));
    await assertFails(setDoc(decision(A,'wrong-decision'),{
      ...proposalData(),conversation_id:'conversation-shared',adventure_id:'idea-1'
    }));
    await assertSucceeds(setDoc(decision(A,'topic-decision'),{
      ...proposalData(),conversation_id:'conversation-idea-1',adventure_id:'idea-1'
    }));
  }finally{await env.cleanup();}
});

test('A member can pass on a suggestion without erasing it or altering a confirmed plan',async()=>{
  const {env,A,B,X}=await context();
  try{
    await assertSucceeds(setDoc(decision(A,'optional-plan'),proposalData()));
    const one=firebaseBackend({db:A.firestore(),storage:null,roomId:room,membership});
    const two=firebaseBackend({db:B.firestore(),storage:null,roomId:room,membership});
    await one.approve({uid:a},'optional-plan');
    await two.decline({uid:b},'optional-plan');
    const d=(await getDoc(decision(A,'optional-plan'))).data();
    assert.equal(d.status,'declined');
    assert.equal(d.declined_by,'person-b');
    assert.ok(d.declined_at);
    assert.equal(d.approvals[a],true); // History of both perspectives is retained.
    assert.equal(await one.approve({uid:a},'optional-plan'),false);
    await assertFails(updateDoc(decision(B,'optional-plan'),{status:'locked'}));
    await assertFails(updateDoc(decision(A,'optional-plan'),{body:'Erase rejection'}));
    await assertFails(updateDoc(decision(X,'optional-plan'),{status:'proposed'}));
  }finally{await env.cleanup();}
});

test('Corrections preserve original authorship and reject missing attachments or another person’s message',async()=>{
  const {env,A,B}=await context();
  try{
    await setDoc(message(A,'original-note'),messageData());
    await assertSucceeds(setDoc(message(A,'corrected-note'),{...messageData(),body:'Fictional correction',corrects_id:'original-note'}));
    await assertFails(setDoc(message(B,'forged-correction'),{...messageData(b),corrects_id:'original-note'}));
    await assertFails(setDoc(message(A,'broken-image'),messageData(a,['missing-image'])));
    assert.equal((await getDoc(message(A,'original-note'))).data().body,'Fictional coastal idea');
  }finally{await env.cleanup();}
});
test('Image writes reject reusable download tokens and mismatched original/preview identities',async()=>{
  const {env,A}=await context();
  try{
    const metadata={contentType:'image/png',customMetadata:{author_uid:a,attachment_id:imageId,role:'original'}};
    await assertFails(uploadBytes(media(A),png,{...metadata,customMetadata:{...metadata.customMetadata,firebaseStorageDownloadTokens:'public-token'}}));
    await assertFails(uploadBytes(media(A),png,{...metadata,customMetadata:{...metadata.customMetadata,attachment_id:'00000000-0000-4000-8000-000000000002'}}));
    await assertFails(uploadBytes(media(A,imageId+'-preview'),png,{...metadata,customMetadata:{...metadata.customMetadata,role:'preview'}}));
  }finally{await env.cleanup();}
});

test('A send retried after a lost acknowledgement keeps exactly one original message',async()=>{
  const {env,A}=await context();
  try{
    const backend=firebaseBackend({db:A.firestore(),storage:null,roomId:room,membership});
    const input={body:'Fictional retry-safe note',messageId:'retry-message'};
    await backend.addMessage({uid:a},input);await backend.addMessage({uid:a},input);
    assert.equal((await getDocs(collection(A.firestore(),'rooms',room,'messages'))).size,1);
    await assert.rejects(backend.addMessage({uid:a},{...input,body:'Changed retry'}),/saved differently/);
  }finally{await env.cleanup();}
});
