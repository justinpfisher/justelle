import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFile,mkdtemp,writeFile,stat} from 'node:fs/promises';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {initializeTestEnvironment,assertFails,assertSucceeds} from '@firebase/rules-unit-testing';
import {doc,collection,getDoc,getDocs,setDoc,updateDoc,deleteDoc,writeBatch,serverTimestamp,onSnapshot} from 'firebase/firestore';
import {ref,uploadBytes,getBytes} from 'firebase/storage';
import {initializeApp,deleteApp} from 'firebase-admin/app';
import {getFirestore} from 'firebase-admin/firestore';
import {getStorage} from 'firebase-admin/storage';
import {plannerBackend} from '../web/planner-backend.mjs';
import {firebaseBackupSource} from '../memory/firebase-backup-source.mjs';
import {generateRecoveryKey,writeEncryptedBackup,restoreEncryptedBackup} from '../memory/encrypted-backup.mjs';
import {validatePortablePlannerRecords} from '../web/plan-integrity.mjs';
const projectId='demo-justelle-pilot',roomId='fictional-room',a='fictional-a',b='fictional-b';
const members={uids:[a,b],people:{[a]:'person-a',[b]:'person-b'},
  labels:{[a]:'Fictional A',[b]:'Fictional B'}};
const planId='fictional-journey';
const bookingId='booking-1',documentId='00000000-0000-4000-8000-000000000099';
const sourceId='source-1';
const stop=(id='stop-1')=>({id,place_id:id,title:'Fictional harbour',from_day:2,through_day:5,status:'planned'});
const booking=()=>({id:bookingId,kind:'stay',stop_id:'stop-1',starts_on:'2026-11-02',
  ends_on:'2026-11-05',status:'confirmed',source_id:sourceId,summary:'Synthetic hotel booking'});
async function setup(){
  const env=await initializeTestEnvironment({projectId,firestore:{host:'127.0.0.1',port:8081,
    rules:await readFile(new URL('../firebase/firestore.rules',import.meta.url),'utf8')},
    storage:{host:'127.0.0.1',port:9199,
      rules:await readFile(new URL('../firebase/storage.rules',import.meta.url),'utf8')}});
  await env.clearFirestore();
  await env.withSecurityRulesDisabled(c=>setDoc(doc(c.firestore(),'rooms',roomId),members));
  const user=uid=>env.authenticatedContext(uid,{justelle_room:roomId,justelle_member:true});
  const A=user(a),B=user(b),X=user('outsider'),U=env.unauthenticatedContext();
  const planner=(ctx,uid)=>plannerBackend({db:ctx.firestore(),roomId,membership:members});
  return {env,A,B,X,U,one:planner(A),two:planner(B),outside:planner(X)};
}
const plan=(ctx,id=planId)=>doc(ctx.firestore(),'rooms',roomId,'adventure_plans',id);
const event=(ctx,id)=>doc(ctx.firestore(),'rooms',roomId,'plan_events',id);
const source=(ctx,id=sourceId)=>doc(ctx.firestore(),'rooms',roomId,'plan_sources',id);
test('Both members read a shared plan; outsiders, revoked/unauthenticated claims and unpaired writes fail',async()=>{
  const {env,A,B,X,U,one,two}=await setup();
  try{
    await one.createPlan({uid:a},{id:planId,title:'Fictional North Shore',durationDays:10,startsOn:'2026-11-01'});
    assert.equal((await two.readPlan(planId)).title,'Fictional North Shore');
    await assertFails(getDoc(plan(X)));
    await assertFails(getDocs(collection(U.firestore(),'rooms',roomId,'adventure_plans')));
    const noClaim=env.authenticatedContext(a);
    await assertFails(getDoc(plan(noClaim)));
    await assertFails(setDoc(plan(X,'outsider'),{state:{id:'outsider'}}));
    await assertFails(updateDoc(plan(B),{'state.title':'Unrecorded overwrite'}));
    const state=(await getDoc(plan(B))).data().state;
    assert.equal(state.revision,0);
    const fabricated={...state,title:'Forged'};
    await assertFails(setDoc(event(A,'fake-event'),{id:'fake-event',adventure_id:planId,
      author_uid:a,author_id:'person-a',created_at:serverTimestamp(),before_state:state,after_state:fabricated}));
    await assertFails(deleteDoc(plan(A)));
  }finally{await env.cleanup();}
});
test('Atomic two-member edits reject stale revisions, preserve history and Undo without approvals',async()=>{
  const {env,A,B,one,two}=await setup();
  try{
    await one.createPlan({uid:a},{id:planId,title:'Fictional journey',durationDays:10,startsOn:'2026-11-01'});
    const updates=[];let unsub=()=>{};
    const observed=new Promise((resolve,reject)=>{
      unsub=onSnapshot(plan(B),s=>{if(s.exists()){updates.push(s.data().state.revision);if(s.data().state.revision>=1)resolve();}},reject);
    });
    const first=await one.editPlan({uid:a},planId,{type:'add_stop',stop:stop()},0);
    await observed;unsub();
    assert.equal(first.plan.revision,1);
    assert.ok(updates.includes(1),'The second member receives the change');
    const raced=await Promise.allSettled([
      one.editPlan({uid:a},planId,{type:'edit_stop',id:'stop-1',patch:{status:'possible'}},1),
      two.editPlan({uid:b},planId,{type:'edit_stop',id:'stop-1',patch:{from_day:3,through_day:6}},1)
    ]);
    assert.equal(raced.filter(x=>x.status==='fulfilled').length,1,'Exactly one stale revision wins');
    assert.equal(raced.filter(x=>x.status==='rejected').length,1);
    const latest=await two.readPlan(planId);
    assert.equal(latest.revision,2);
    await assert.rejects(two.editPlan({uid:b},planId,{type:'edit_stop',id:'stop-1',
      patch:{title:'Stale conflict'}},1),/changed/);
    await two.editPlan({uid:b},planId,{type:'undo_last'},2);
    const restored=await one.readPlan(planId);
    assert.equal(restored.revision,3);
    assert.deepEqual(restored.stops[0],first.plan.stops[0]);
    const history=await one.readHistory(planId);
    assert.deepEqual(history.map(e=>e.revision),[0,1,2,3]);
    assert.deepEqual(history.map(e=>e.actor_id).filter(x=>x==='person-b').length>=1,true);
    assert.equal(history[2].after_state.revision,2);
    assert.equal(history[3].before_state.revision,2);
    await assertFails(updateDoc(event(A,history[1].id),{actor_id:'outsider'}));
    await assertFails(deleteDoc(event(B,history[1].id)));
  }finally{await env.cleanup();}
});
test('External originals stay independent of intended booking edits, and legacy pilot documents are isolated',async()=>{
  const {env,A,B,X,one,two}=await setup();
  try{
    await env.withSecurityRulesDisabled(c=>setDoc(doc(c.firestore(),'rooms',roomId,'adventures',planId),
      {id:planId,title:'Older fictional memory',phase:'memory',phases:['memory'],author_id:'person-a',
        conversation_id:'conversation-'+planId,source_message_id:null,last_event_id:null}));
    await one.createPlan({uid:a},{id:planId,title:'New journey',durationDays:10,startsOn:'2026-11-01'});
    await one.addSource({uid:a},{id:sourceId,adventureId:planId,kind:'booking',
      title:'Synthetic supplier confirmation',supplier:'Fictional Inn',reference:'TEST-ONLY'});
    await one.editPlan({uid:a},planId,{type:'add_stop',stop:stop()},0);
    await two.editPlan({uid:b},planId,{type:'add_booking',booking:booking()},1);
    const original=(await getDoc(source(B))).data();
    await two.editPlan({uid:b},planId,{type:'edit_stop',id:'stop-1',
      patch:{from_day:4,through_day:7}},2);
    assert.equal((await one.readPlan(planId)).bookings[0].starts_on,'2026-11-02');
    await one.editPlan({uid:a},planId,{type:'correct_booking',id:bookingId,
      patch:{summary:'Correction to copied details'}},3);
    assert.equal((await getDoc(source(A))).data().reference,original.reference);
    await assertFails(updateDoc(source(B),{reference:'Tampered'}));
    await assertFails(getDoc(source(X)));
    await assertFails(setDoc(source(B,'forged'),{...original,id:'forged',author_uid:a,
      created_at:serverTimestamp()}));
    assert.equal((await getDoc(doc(A.firestore(),'rooms',roomId,'adventures',planId))).data().title,
      'Older fictional memory');
    assert.equal((await getDoc(plan(B))).data().state.revision,4);
  }finally{await env.cleanup();}
});
test('Protected source PDF and complete plan/event/history restore work without Firebase',async()=>{
  const {env,A,B,X,one,two}=await setup();
  const admin=initializeApp({projectId,storageBucket:projectId+'.firebasestorage.app'},
    'planner-backup-test-'+Date.now()),db=getFirestore(admin);
  try{
    await one.createPlan({uid:a},{id:planId,title:'Fictional portable voyage',
      durationDays:10,startsOn:'2026-11-01'});
    const pdf=Buffer.from('%PDF-1.4\n1 0 obj\n<< /Type /Catalog >>\nendobj\n%%EOF\n');
    const transport={async uploadDocument(id,bytes,mime){
      assert.equal(id,documentId);assert.equal(mime,'application/pdf');
      await env.withSecurityRulesDisabled(c=>uploadBytes(ref(c.storage('gs://'+projectId+'.firebasestorage.app'),
        'rooms/'+roomId+'/documents/'+id),bytes,{contentType:mime}));
    }};
    const documentPlanner=plannerBackend({db:A.firestore(),roomId,membership:members,mediaTransport:transport});
    await documentPlanner.addDocument({uid:a},{id:documentId,adventureId:planId,
      file:{type:'application/pdf',size:pdf.length,name:'fictional-confirmation.pdf',
        arrayBuffer:async()=>pdf}});
    await one.addSource({uid:a},{id:sourceId,adventureId:planId,kind:'booking',
      title:'Original fictional booking',documentId});
    await one.editPlan({uid:a},planId,{type:'add_stop',stop:stop()},0);
    await two.editPlan({uid:b},planId,{type:'add_booking',booking:booking()},1);
    await two.editPlan({uid:b},planId,{type:'correct_booking',id:bookingId,
      patch:{summary:'Clearly identified correction'}},2);
    await one.editPlan({uid:a},planId,{type:'add_experience',experience:{
      id:'fictional-activity',title:'Unbooked harbour walk',day:5,status:'possible',notes:'Weather permitting'
    }},3);
    await assertFails(getDoc(doc(X.firestore(),'rooms',roomId,'plan_documents',documentId)));
    await assertFails(getBytes(ref(X.storage('gs://'+projectId+'.firebasestorage.app'),
      'rooms/'+roomId+'/documents/'+documentId)));
    await assertFails(updateDoc(doc(B.firestore(),'rooms',roomId,'plan_documents',documentId),{name:'New original'}));
    const snapshot=await firebaseBackupSource({db,bucket:getStorage(admin).bucket(),pageSize:1});
    assert.equal(snapshot.records.adventure_plans.length,1);
    assert.equal(snapshot.records.plan_events.length,5);
    assert.equal(snapshot.records.plan_sources.length,1);
    assert.equal(snapshot.records.plan_documents.length,1);
    validatePortablePlannerRecords(snapshot.records);
    const folder=await mkdtemp(join(tmpdir(),'justelle-planner-m1-')),destination=join(folder,'test.jmb');
    const key=generateRecoveryKey();
    await writeEncryptedBackup({...snapshot,key},destination);
    const output=join(folder,'clean-recovery');await restoreEncryptedBackup(destination,key,output);
    const recovered=JSON.parse(await readFile(join(output,'records.json'),'utf8'));
    assert.equal(recovered.adventure_plans[0].state.bookings[0].summary,
      'Clearly identified correction');
    assert.equal(recovered.adventure_plans[0].state.experiences[0].title,'Unbooked harbour walk');
    assert.ok(recovered.plan_events.some(e=>e.operation==='add_experience'&&e.collection==='experiences'));
    assert.equal(recovered.plan_events.find(e=>e.revision===2).after_state.bookings[0].summary,'Synthetic hotel booking');
    assert.equal(recovered.plan_sources[0].reference,'');
    assert.equal(recovered.plan_documents[0].storage_path,'documents/'+documentId);
    assert.deepEqual(await readFile(join(output,'media','doc-'+documentId)),pdf);
    assert.equal(JSON.stringify(recovered).includes('fictional-a'),false,
      'Portable records must not contain Firebase account IDs');
    const damaged=structuredClone(recovered);
    damaged.plan_events.find(e=>e.revision===1).after_state.stops[0].title='Altered historical stop';
    assert.throws(()=>validatePortablePlannerRecords(damaged),/integrity/);
    const corruptExperience=structuredClone(recovered);
    corruptExperience.adventure_plans[0].state.experiences[0].day=99;
    assert.throws(()=>validatePortablePlannerRecords(corruptExperience),/integrity/);
    const orphan=structuredClone(recovered);orphan.plan_sources=[];
    assert.throws(()=>validatePortablePlannerRecords(orphan),/source|booking/);
    await assert.rejects(restoreEncryptedBackup(destination,generateRecoveryKey(),join(folder,'wrong-key')),/authentication/);
    await assert.rejects(stat(join(folder,'wrong-key')),{code:'ENOENT'});
  }finally{await db.terminate();await deleteApp(admin);await env.cleanup();}
});

test('Unverified transfers persist independently; forged confirmation and partial writes cannot mutate a plan',async()=>{
  const {env,A,B,one,two}=await setup();
  try{
    await one.createPlan({uid:a},{id:planId,title:'Fictional transfers',durationDays:10,startsOn:'2026-11-01'});
    const transfer={id:'transfer-1',kind:'transport',stop_id:null,starts_on:'2026-11-04',
      ends_on:'2026-11-04',status:'unverified',source_id:null,summary:'Possible ferry'};
    await two.editPlan({uid:b},planId,{type:'add_booking',booking:transfer},0);
    const saved=await one.readPlan(planId);
    assert.equal(saved.bookings[0].kind,'transport');assert.equal(saved.bookings[0].status,'unverified');
    await assert.rejects(one.editPlan({uid:a},planId,{type:'add_booking',booking:{
      ...transfer,id:'confirmed-without-proof',status:'confirmed',source_id:'missing-source'}},1),
      /source.*missing/i);
    assert.equal((await two.readPlan(planId)).revision,1);
    assert.equal((await one.readHistory(planId)).length,2);
    // Deliberately forge a valid-looking atomic plan/event pair to try to slip
    // a confirmed booking into an unrelated change: security rules must reject.
    const altered=structuredClone(saved);
    altered.revision=2;altered.last_event_id='forged-edit';
    altered.bookings.push({...transfer,id:'forged-confirmed',status:'confirmed'});
    const batch=writeBatch(A.firestore());
    batch.update(plan(A),{state:altered,last_modified_by:'person-a',updated_at:serverTimestamp()});
    batch.set(event(A,'forged-edit'),{id:'forged-edit',adventure_id:planId,revision:2,
      previous_event_id:saved.last_event_id,actor_id:'person-a',author_uid:a,author_id:'person-a',
      at:serverTimestamp(),created_at:serverTimestamp(),operation:'edit_stop',collection:'stops',
      record_id:'forged',before:null,after:null,before_state:saved,after_state:altered});
    await assertFails(batch.commit());
    assert.equal((await one.readPlan(planId)).revision,1);
    assert.equal((await two.readHistory(planId)).length,2);
  }finally{await env.cleanup();}
});


test('Fictional original PDF uploads are private, immutable and readable to the second member',async()=>{
 const freshDocumentId='00000000-0000-4000-8000-000000000098';
 const {env,A,B,X,one}=await setup();
 try{
   await one.createPlan({uid:a},{id:planId,title:'Fictional protected documents',durationDays:10,startsOn:'2026-11-01'});
   const bytes=Buffer.from('%PDF-1.4\\nfictional original\\n%%EOF\\n');
   const uploader=plannerBackend({db:A.firestore(),storage:A.storage('gs://'+projectId+'.firebasestorage.app'),
     roomId,membership:members});
   const reader=plannerBackend({db:B.firestore(),storage:B.storage('gs://'+projectId+'.firebasestorage.app'),
     roomId,membership:members});
   await uploader.addDocument({uid:a},{id:freshDocumentId,adventureId:planId,file:{
     name:'synthetic.pdf',type:'application/pdf',size:bytes.length,arrayBuffer:async()=>bytes
   }});
   assert.deepEqual(Buffer.from(await reader.documentBytes(freshDocumentId)),bytes);
   assert.equal((await reader.readDocuments(planId)).length,1);
   const location=ref(A.storage('gs://'+projectId+'.firebasestorage.app'),'rooms/'+roomId+'/documents/'+freshDocumentId);
   await assertFails(uploadBytes(location,Buffer.from('different'),{contentType:'application/pdf'}));
   const denied=ref(X.storage('gs://'+projectId+'.firebasestorage.app'),'rooms/'+roomId+'/documents/'+freshDocumentId);
   await assertFails(getBytes(denied));
   await assertFails(getDoc(doc(X.firestore(),'rooms',roomId,'plan_documents',freshDocumentId)));
 }finally{await env.cleanup();}
});

test('Both members can revise day experiences; outsiders and forged revisions remain blocked',async()=>{
  const {env,A,B,X,one,two}=await setup();
  try{
    await one.createPlan({uid:a},{id:planId,title:'Fictional shared day plan',
      durationDays:10,startsOn:'2026-11-01'});
    await one.editPlan({uid:a},planId,{type:'add_experience',experience:{
      id:'fictional-visit',title:'Test museum',day:3,status:'possible',notes:''
    }},0);
    const latest=await two.readPlan(planId);
    assert.equal(latest.experiences[0].title,'Test museum');
    assert.equal(latest.bookings.length,0);
    await two.editPlan({uid:b},planId,{type:'edit_experience',id:'fictional-visit',
      patch:{title:'Test gallery',day:4,status:'planned'}},1);
    await assert.rejects(one.editPlan({uid:a},planId,{type:'edit_experience',
      id:'fictional-visit',patch:{day:5}},1),/changed/);
    const history=await two.readHistory(planId);
    assert.deepEqual(history.map(e=>e.collection),['trip','experiences','experiences']);
    await one.editPlan({uid:a},planId,{type:'undo_last'},2);
    assert.equal((await two.readPlan(planId)).experiences[0].day,3);
    assert.equal((await one.readHistory(planId)).length,4);
    await assertFails(getDoc(plan(X)));
    await assertFails(updateDoc(event(A,history[1].id),{operation:'correct_booking'}));
    await assertFails(updateDoc(plan(B),{'state.experiences':[]}));
  }finally{await env.cleanup();}
});
