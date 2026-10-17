import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFile,mkdtemp,readdir} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createHash} from 'node:crypto';
import { initializeTestEnvironment, assertFails, assertSucceeds } from '@firebase/rules-unit-testing';
import { doc, collection, getDoc, getDocs, setDoc, updateDoc } from 'firebase/firestore';
import { ref, uploadBytes, getBytes, getMetadata } from 'firebase/storage';
import {restoreArchive} from '../common/restore.mjs';

const projectId='demo-justelle-poc', room='fictional-room', a='fictional-a', b='fictional-b';
const fileId='00000000-0000-4000-8000-000000000001';
const path=`rooms/${room}/media/${fileId}.png`;
const png=Uint8Array.from(await readFile(new URL('../fixtures/fictional-landscape.png',import.meta.url))); // synthetic image

async function context(){
  const env=await initializeTestEnvironment({
    projectId,
    firestore:{host:'127.0.0.1',port:8081,rules:await readFile(new URL('../firebase/firestore.rules',import.meta.url),'utf8')},
    storage:{host:'127.0.0.1',port:9199,rules:await readFile(new URL('../firebase/storage.rules',import.meta.url),'utf8')}
  });
  // Each test must start from empty emulated stores; cleanup() only closes clients.
  await env.clearFirestore();
  await env.clearStorage();
  await env.withSecurityRulesDisabled(async c=>setDoc(doc(c.firestore(),'rooms',room),{uids:[a,b]}));
  const ctx=uid=>env.authenticatedContext(uid,{justelle_room:room,justelle_member:true});
  return {env,A:ctx(a),B:ctx(b),X:ctx('fictional-outsider'),U:env.unauthenticatedContext()};
}
const messageRef=(c,id)=>doc(c.firestore(),'rooms',room,'messages',id);
const decisionRef=(c,id)=>doc(c.firestore(),'rooms',room,'decisions',id);
const storageRef=(c,id=fileId)=>ref(c.storage(`gs://${projectId}.firebasestorage.app`),`rooms/${room}/media/${id}.png`);

// All tests use emulated Firestore/Storage and mock Auth claims, not real cloud resources.
test('Firebase: two users share messages, outsiders cannot read or spoof authorship',async()=>{
  const {env,A,B,X,U}=await context();
  try {
    await assertSucceeds(setDoc(messageRef(A,'fictional-message-1'),{body:'Fictional idea from A',author_uid:a,created_at:'2026-10-10T00:00:00Z'}));
    await assertSucceeds(setDoc(messageRef(B,'fictional-message-2'),{body:'Fictional reply from B',author_uid:b,created_at:'2026-10-10T00:01:00Z'}));
    assert.equal((await getDocs(collection(B.firestore(),'rooms',room,'messages'))).size,2);
    await assertFails(getDocs(collection(X.firestore(),'rooms',room,'messages')));
    await assertFails(getDoc(messageRef(U,'fictional-message-1')));
    await assertFails(setDoc(messageRef(A,'fake'),{body:'Forgery',author_uid:b,created_at:'2026-10-10T00:01:00Z'}));
  }finally{await env.cleanup();}
});

test('Firebase: one-person AI-style proposal cannot become locked without two distinct approvals',async()=>{
  const {env,A,B,X}=await context();
  try {
    const d='fictional-proposal-1';
    const payload={body:'Fictional AI suggestion: visit the meteor garden.',author_uid:a,created_at:'2026-10-10T00:00:00Z',status:'proposed',approvals:{}};
    await assertSucceeds(setDoc(decisionRef(A,d),payload));
    await assertFails(updateDoc(decisionRef(A,d),{approvals:{[a]:true,[b]:true},status:'locked'}));
    await assertFails(updateDoc(decisionRef(X,d),{[`approvals.fictional-outsider`]:true}));
    await assertSucceeds(updateDoc(decisionRef(A,d),{[`approvals.${a}`]:true}));
    assert.equal((await getDoc(decisionRef(B,d))).data().status,'proposed');
    await assertFails(updateDoc(decisionRef(A,d),{status:'locked'}));
    await assertSucceeds(updateDoc(decisionRef(B,d),{[`approvals.${b}`]:true,status:'locked'}));
    assert.equal((await getDoc(decisionRef(A,d))).data().status,'locked');
    await assertFails(updateDoc(decisionRef(A,d),{body:'Replace confirmed choice'}));
    await assertFails(updateDoc(decisionRef(B,d),{status:'proposed'}));
  }finally{await env.cleanup();}
});

test('Firebase: photo access requires membership and file changes remain restricted',async()=>{
  const {env,A,B,X,U}=await context();
  try {
    await assertSucceeds(uploadBytes(storageRef(A),png,{contentType:'image/png',customMetadata:{author_uid:a}}));
    assert.deepEqual(Buffer.from(await getBytes(storageRef(B))),Buffer.from(png));
    await assertFails(getBytes(storageRef(X)));
    await assertFails(getBytes(storageRef(U)));
    await assertFails(uploadBytes(ref(A.storage(`gs://${projectId}.firebasestorage.app`),`rooms/${room}/media/wrong.txt`),png,{contentType:'text/plain',customMetadata:{author_uid:a}}));
    await assertFails(uploadBytes(storageRef(B),png,{contentType:'image/png',customMetadata:{author_uid:b}}));
  }finally{await env.cleanup();}
});

test('Firebase: exported fictional records and media restore into independent SQLite',async()=>{
  const {env,A,B}=await context();
  try {
    const msg='fictional-message-export';const did='fictional-decision-export';
    const exportFileId='00000000-0000-4000-8000-000000000002';
    await setDoc(messageRef(A,msg),{body:'Fictional shared chat',author_uid:a,created_at:'2026-10-10T00:00:00Z'});
    await setDoc(decisionRef(A,did),{body:'Fictional agreed plan',author_uid:a,created_at:'2026-10-10T00:00:00Z',status:'proposed',approvals:{}});
    await updateDoc(decisionRef(A,did),{[`approvals.${a}`]:true});
    await updateDoc(decisionRef(B,did),{[`approvals.${b}`]:true,status:'locked'});
    await uploadBytes(storageRef(A,exportFileId),png,{contentType:'image/png',customMetadata:{author_uid:a}});
    const docs=await getDocs(collection(B.firestore(),'rooms',room,'messages'));
    const decisions=await getDocs(collection(B.firestore(),'rooms',room,'decisions'));
    const bytes=Buffer.from(await getBytes(storageRef(B,exportFileId)));
    const metadata=await getMetadata(storageRef(B,exportFileId));
    const bundle={format:'justelle-poc-v1',room,
      messages:docs.docs.map(d=>({id:d.id,room,body:d.data().body,author_id:d.data().author_uid===a?'person-a':'person-b',created_at:d.data().created_at})),
      decisions:decisions.docs.map(d=>({id:d.id,room,author_id:d.data().author_uid===a?'person-a':'person-b',body:d.data().body,status:d.data().status,created_at:d.data().created_at})),
      approvals:decisions.docs.flatMap(d=>Object.keys(d.data().approvals).map(uid=>({decision_id:d.id,person_id:uid===a?'person-a':'person-b',created_at:'2026-10-10T00:00:00Z'}))),
      files:[{id:exportFileId,room,author_id:metadata.customMetadata.author_uid===a?'person-a':'person-b',mime:metadata.contentType,sha256:createHash('sha256').update(bytes).digest('hex'),bytes:bytes.toString('base64'),created_at:'2026-10-10T00:00:00Z'}]
    };
    const restored=await mkdtemp(join(tmpdir(),'justelle-firebase-poc-'));
    assert.deepEqual(await restoreArchive(bundle,restored),{messages:1,decisions:1,locked:1,files:1});
    assert.equal((await readdir(join(restored,'media'))).length,1);
  } finally {await env.cleanup();}
});
