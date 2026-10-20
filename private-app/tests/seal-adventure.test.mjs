import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {mkdtemp,readFile,stat,unlink,writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {Readable} from 'node:stream';
import {createItinerary,applyItineraryEdit} from '../web/itinerary-core.mjs';
import {verifyRecords} from '../web/archive-core.mjs';
import {generateRecoveryKey,writeEncryptedBackup,restoreEncryptedBackup} from '../memory/encrypted-backup.mjs';
import {selectSealedAdventure,sealArchivedAdventureFromRestore,SEALED_TRIP_FORMAT} from '../memory/seal-adventure.mjs';
import {main as recoveryCLI} from '../memory/backup-cli.mjs';

const trip='fictional-archived-trip',other='fictional-other-trip';
const docId='00000000-0000-4000-8000-000000000731';
const foreignDocId='00000000-0000-4000-8000-000000000732';
const sourceId='00000000-0000-4000-8000-000000000733';
const pdf=Buffer.from('%PDF-1.4\n1 0 obj\n<< /Type /Catalog >>\nendobj\n%%EOF\n');
const otherPdf=Buffer.from('%PDF-1.4\nSynthetic unrelated original\n%%EOF\n');
const time='2026-10-19T12:00:00.000Z';
const hash=b=>createHash('sha256').update(b).digest('hex');
function fixture(){
 const start=createItinerary({id:trip,title:'Fictional coast',startsOn:'2026-11-01',durationDays:6});
 start.last_event_id='created';
 const event0={id:'created',adventure_id:trip,revision:0,previous_event_id:null,
   actor_id:'person-a',author_id:'person-a',at:time,created_at:time,
   operation:'create_trip',collection:'trip',record_id:trip,before:null,after:start,
   before_state:null,after_state:start};
 let current=start,events=[event0];
 function edit(change,id,actor='person-a'){
   const previous=current,{plan,event}=applyItineraryEdit(current,change,{eventId:id,actorId:actor,at:time});
   current=plan;events.push({...event,author_id:actor,created_at:time,at:time,
     before_state:previous,after_state:plan});
 }
 edit({type:'add_stop',stop:{id:'base',place_id:'base',title:'Synthetic bay',
   from_day:1,through_day:5,status:'planned'}},'stay');
 edit({type:'add_booking',booking:{id:'hotel',kind:'stay',stop_id:'base',
   starts_on:'2026-11-01',ends_on:'2026-11-05',status:'confirmed',
   source_id:sourceId,summary:'Fictional hotel'}},'booking','person-b');
 edit({type:'set_status',status:'archived'},'archived','person-b');
 const unrelated=createItinerary({id:other,title:'Unrelated fictional plan',durationDays:3});
 unrelated.last_event_id='other-created';
 const unrelatedEvent={...event0,id:'other-created',adventure_id:other,record_id:other,
   after:unrelated,after_state:unrelated};
 const document=(id,adventureId,bytes,author='person-a')=>({id,adventure_id:adventureId,
   name:'fictional-confirmation.pdf',mime:'application/pdf',size:bytes.length,sha256:hash(bytes),
   author_id:author,created_at:time,storage_path:'documents/'+id});
 const records={persons:[{id:'person-a',label:'Fictional A'},{id:'person-b',label:'Fictional B'}],
   conversations:[],messages:[],decisions:[],adventures:[],attachments:[],adventure_events:[],
   adventure_plans:[{id:trip,state:current,author_id:'person-a',last_modified_by:'person-b',
     created_at:time,updated_at:time},
     {id:other,state:unrelated,author_id:'person-b',last_modified_by:'person-b',
       created_at:time,updated_at:time}],
   plan_events:[...events,unrelatedEvent],
   plan_sources:[{id:sourceId,adventure_id:trip,kind:'booking',title:'Original booking',
     notes:'Fictional source text',supplier:'Fictional supplier',reference:'',document_id:docId,
     author_id:'person-a',created_at:time}],
   plan_documents:[document(docId,trip,pdf),document(foreignDocId,other,otherPdf,'person-b')]};
 verifyRecords(records);
 return records;
}
async function snapshot(){
 const dir=await mkdtemp(join(tmpdir(),'justelle-seal-fictional-'));
 const original=join(dir,'full.jmb'),restored=join(dir,'full-restored');
 const key=generateRecoveryKey(),records=fixture();
 await writeEncryptedBackup({records,key,media:[
   {id:'doc-'+docId,mime:'application/pdf',stream:Readable.from([pdf])},
   {id:'doc-'+foreignDocId,mime:'application/pdf',stream:Readable.from([otherPdf])}]},original);
 await restoreEncryptedBackup(original,key,restored);
 return {dir,original,restored,key,records};
}
test('Member-marked archive seals exact plan events, source and PDF; unrelated trip is excluded',async()=>{
 const x=await snapshot(),sealed=join(x.dir,'trip-r3.jmb');
 const result=await sealArchivedAdventureFromRestore({restoredDirectory:x.restored,
   adventureId:trip,key:x.key,destination:sealed});
 assert.equal(result.revision,3);
 assert.equal(result.last_event_id,'archived');
 assert.equal(result.files,1);
 assert.equal(result.cloud_copy_verified,false);
 assert.equal(result.safe_to_delete_source,false);
 const out=join(x.dir,'trip-restored');
 await restoreEncryptedBackup(sealed,x.key,out);
 const r=JSON.parse(await readFile(join(out,'records.json'),'utf8'));
 assert.deepEqual(r.sealed_adventure,{format:SEALED_TRIP_FORMAT,adventure_id:trip,
   revision:3,last_event_id:'archived'});
 assert.deepEqual(r.adventure_plans.map(p=>p.id),[trip]);
 assert.deepEqual(r.plan_events.map(e=>e.id),['created','stay','booking','archived']);
 assert.deepEqual(r.plan_sources.map(s=>s.document_id),[docId]);
 assert.deepEqual(r.plan_documents.map(d=>d.id),[docId]);
 assert.equal(r.adventure_plans[0].state.bookings[0].status,'confirmed');
 assert.equal(r.plan_events[2].actor_id,'person-b');
 assert.deepEqual(await readFile(join(out,'media','doc-'+docId)),pdf);
 await assert.rejects(stat(join(out,'media','doc-'+foreignDocId)),{code:'ENOENT'});
 assert.deepEqual(await readFile(join(x.restored,'media','doc-'+foreignDocId)),otherPdf);
 await assert.rejects(sealArchivedAdventureFromRestore({restoredDirectory:x.restored,
   adventureId:trip,key:x.key,destination:sealed}),/already exists/);
});
test('Unarchived adventures, linked legacy discussions and forged seal boundaries fail closed',async()=>{
 const r=fixture();
 assert.throws(()=>selectSealedAdventure(r,other),/explicitly moved/);
 assert.throws(()=>selectSealedAdventure(r,'not-real'),/Only an adventure/);
 const linked=structuredClone(r);linked.messages.push({id:'legacy-note',adventure_id:trip,
   body:'Fictional original message',kind:'person',author_id:'person-a',conversation_id:'shared',
   attachment_ids:[],created_at:time});
 linked.conversations.push({id:'shared',kind:'shared'});
 linked.adventures.push({id:trip,title:'Legacy linked fictional discussion',
   phase:'plan',phases:['plan'],author_id:'person-a',last_event_id:null,
   source_message_id:'legacy-note',conversation_id:'shared',
   created_at:time,updated_at:time});
 assert.throws(()=>selectSealedAdventure(linked,trip),/historical discussion/);
 const selected=selectSealedAdventure(r,trip);
 const broken=structuredClone(selected);broken.sealed_adventure.revision++;
 assert.throws(()=>verifyRecords(broken),/sealed adventure event boundary/);
 const unrelated=structuredClone(selected);unrelated.conversations.push({id:'shared',kind:'shared'});
 assert.throws(()=>verifyRecords(unrelated),/sealed adventure event boundary/);
});
test('Late member corrections require a new archive generation without rewriting earlier history',()=>{
 const r=fixture(),first=selectSealedAdventure(r,trip),old=r.adventure_plans[0].state;
 const {plan,event}=applyItineraryEdit(old,{type:'add_lesson',id:'later-lesson',
   text:'Fictional lesson after archive'}, {eventId:'late-note',actorId:'person-a',at:time});
 const newer=structuredClone(r);
 newer.adventure_plans[0].state=plan;newer.adventure_plans[0].last_modified_by='person-a';
 newer.plan_events.push({...event,author_id:'person-a',created_at:time,
   before_state:old,after_state:plan});
 const second=selectSealedAdventure(newer,trip);
 assert.equal(first.sealed_adventure.revision,3);
 assert.equal(first.plan_events.length,4);
 assert.equal(second.sealed_adventure.revision,4);
 assert.equal(second.sealed_adventure.last_event_id,'late-note');
 assert.equal(second.plan_events.length,5);
 assert.deepEqual(second.plan_documents,first.plan_documents);
});
test('Missing original PDF aborts sealing without publishing a partial ciphertext',async()=>{
 const x=await snapshot(),destination=join(x.dir,'missing.jmb');
 await unlink(join(x.restored,'media','doc-'+docId));
 await assert.rejects(sealArchivedAdventureFromRestore({restoredDirectory:x.restored,
   adventureId:trip,key:x.key,destination}),/ENOENT|no such file/);
 await assert.rejects(stat(destination),{code:'ENOENT'});
 assert.ok(await stat(x.original),'Whole encrypted backup remains available');
});

test('Existing offline recovery CLI can seal and restore without access to providers',async()=>{
 const x=await snapshot(),keyPath=join(x.dir,'private-test-key'),sealed=join(x.dir,'cli-sealed.jmb');
 await writeFile(keyPath,x.key,{mode:0o600});
 const result=await recoveryCLI(['seal',keyPath,x.restored,trip,sealed]);
 assert.equal(result.safe_to_delete_source,false);
 await recoveryCLI(['restore',keyPath,sealed,join(x.dir,'cli-restored')]);
 const r=JSON.parse(await readFile(join(x.dir,'cli-restored','records.json'),'utf8'));
 assert.equal(r.sealed_adventure.last_event_id,'archived');
 await assert.rejects(recoveryCLI(['seal',keyPath,x.restored,other,
   join(x.dir,'unarchived.jmb')]),/explicitly moved/);
});
