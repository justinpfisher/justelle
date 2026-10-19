import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {createItinerary} from '../web/itinerary-core.mjs';
import {createPlannerSuggestionService} from '../ai/planner-suggestion-service.mjs';
const sourceId='00000000-0000-4000-8000-000000000201';
const documentId='00000000-0000-4000-8000-000000000202';
const bytes=Buffer.from('fictional-png-bytes');
const sha256=createHash('sha256').update(bytes).digest('hex');
const plan=()=>createItinerary({id:'fictional-trip',title:'Fictional islands',durationDays:8});
const candidate=()=>({kind:'suggestion',operation:'add_experience',
  title:'Fictional museum',day:2,nights:0,status:'possible',
  explanation:'The note proposes an activity.',uncertainty:'No ticket is booked.'});
function setup({image=true,outsider=false,corrupt=false,stale=false,revoked=false}={}){
 const root='rooms/fictional-room',planRecord=plan(),calls=[],limits=[];
 const room={uids:['fictional-a','fictional-b'],
   people:{'fictional-a':'person-a','fictional-b':'person-b'},revoked_auth_before:{}};
 const documents=new Map([
   [root,room],
   [root+'/adventure_plans/fictional-trip',{state:planRecord}],
   [root+'/plan_sources/'+sourceId,{id:sourceId,adventure_id:'fictional-trip',
     kind:'note',notes:'Consider a museum on day 2',document_id:image?documentId:null}],
   [root+'/plan_documents/'+documentId,{id:documentId,adventure_id:'fictional-trip',
     mime:'image/png',size:bytes.length,sha256,author_uid:'fictional-a',
     storage_path:root+'/documents/'+documentId}]
 ]);
 const db={doc(path){return {async get(){return {exists:documents.has(path),
   data:()=>documents.get(path)};}}}};
 const bucket={file(path){assert.equal(path,root+'/documents/'+documentId);
   return {async getMetadata(){return [{contentType:'image/png',size:bytes.length,
     metadata:{attachment_id:documentId,role:'document',author_uid:'fictional-a',
       sha256,...(corrupt?{firebaseStorageDownloadTokens:'unsafe'}:{})}}];},
     async download(){return [bytes];}};}};
 const verifyIdentity=async()=>{if(revoked)throw Error('Revoked identity');return {
   uid:outsider?'outsider':'fictional-a',justelle_member:true,
   justelle_room:'fictional-room',auth_time:100}};
 const service=createPlannerSuggestionService({db,bucket,roomId:'fictional-room',
   verifyIdentity,rateLimit:async uid=>limits.push(uid),
   provider:async()=>({async suggest(input){
     calls.push(input);
     if(stale)planRecord.revision++;
     return candidate();
   }})});
 return {service,calls,limits,documents,room};
}
const request=()=>({plan_id:'fictional-trip',revision:0,source_id:sourceId});
test('Two-member authorisation verifies screenshot integrity then offers read-only draft',async()=>{
 const s=setup(),result=await s.service('fictional-token',request());
 assert.equal(result.kind,'preview');assert.equal(result.source_id,sourceId);
 assert.equal(result.plan_id,'fictional-trip');assert.equal(result.revision,0);
 assert.equal(result.change.type,'add_experience');
 assert.equal(result.change.experience.day,2);
 assert.equal(s.calls[0].images[0].bytes.length,bytes.length);
 assert.equal(s.calls[0].text,'Consider a museum on day 2');
 assert.deepEqual(s.limits,['fictional-a']);
 assert.equal(s.documents.get('rooms/fictional-room/adventure_plans/fictional-trip').state.revision,0);
});
test('Denied or revoked identities and malformed references never reach provider',async()=>{
 for(const options of [{outsider:true},{revoked:true}]){
   const s=setup(options);
   await assert.rejects(s.service('token',request()),e=>[401,403].includes(e.status));
   assert.equal(s.calls.length,0);
 }
 const s=setup();
 for(const wrong of [
   {...request(),extra:'unrestricted write'},
   {...request(),source_id:'../../other-room'},
   {...request(),plan_id:'another-trip'}
 ])await assert.rejects(s.service('token',wrong));
 assert.equal(s.calls.length,0);
});
test('Source cannot be borrowed across adventures and direct-file tokens fail closed',async()=>{
 const foreign=setup();
 foreign.documents.get('rooms/fictional-room/plan_sources/'+sourceId).adventure_id='other-trip';
 await assert.rejects(foreign.service('token',request()),/Planning note not found/);
 assert.equal(foreign.calls.length,0);
 const unsafe=setup({corrupt:true});
 await assert.rejects(unsafe.service('token',request()),/Screenshot integrity/);
 assert.equal(unsafe.calls.length,0);
});
test('Optimistic revision is rechecked after model completion, never returns stale change',async()=>{
 const s=setup({stale:true});
 await assert.rejects(s.service('token',request()),e=>e.status===409);
 assert.equal(s.calls.length,1);
});
test('Original text works without screenshots; attachment-free requests cannot be blank',async()=>{
 const s=setup({image:false});
 const output=await s.service('token',request());assert.equal(output.kind,'preview');
 const note=s.documents.get('rooms/fictional-room/plan_sources/'+sourceId);
 note.notes='';
 await assert.rejects(s.service('token',request()),e=>e.status===400);
});
