import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFile,mkdtemp,stat} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {DatabaseSync} from 'node:sqlite';
import {createArchive,verifyArchive} from '../web/archive-core.mjs';
import {restoreArchive} from '../memory/restore.mjs';
import {sha256} from '../web/media.mjs';

const id='00000000-0000-4000-8000-000000000003';
const fixture=new Uint8Array(await readFile(new URL('./fictional-landscape.png',import.meta.url)));
async function example() {
  const records={
    persons:[{id:'person-a',label:'Fictional A'},{id:'person-b',label:'Fictional B'}],
    conversations:[{id:'conversation-shared',kind:'shared'}],
    adventures:[{id:'idea-1',title:'Fictional floating garden',phase:'plan',phases:['idea','plan'],author_id:'person-a',last_modified_by:'person-b',source_message_id:'message-1',conversation_id:'conversation-shared',created_at:'2026-10-11T00:00:00Z',updated_at:'2026-10-11T00:00:01Z'}],
    messages:[{id:'message-1',body:'Fictional screenshot of a garden',author_id:'person-a',kind:'person',conversation_id:'conversation-shared',adventure_id:null,source_message_id:null,attachment_ids:[id],created_at:'2026-10-11T00:00:00Z'}],
    decisions:[{id:'decision-1',body:'Fictional visit',why:'A dry run',origin:'ai',author_id:'ai-mock',conversation_id:'conversation-shared',adventure_id:'idea-1',source_message_id:'message-1',replaces_id:null,status:'locked',created_at:'2026-10-11T00:00:01Z',locked_at:'2026-10-11T00:00:03Z',approvals:[{person_id:'person-a',at:'2026-10-11T00:00:02Z'},{person_id:'person-b',at:'2026-10-11T00:00:03Z'}]}],
    attachments:[{id,name:'fictional-landscape.png',mime:'image/png',size:fixture.length,sha256:await sha256(fixture),author_id:'person-a',preview_path:null,created_at:'2026-10-11T00:00:00Z'}]
  };
  return createArchive(records,[{id,mime:'image/png',bytes:fixture}]);
}
test('Restores fictional authors, agreements, phases and exact original image independently',async()=>{
  const bundle=await example();
  const folder=await mkdtemp(join(tmpdir(),'justelle-archive-'));
  const output=join(folder,'restored');
  const counts=await restoreArchive(bundle,output);
  assert.deepEqual(counts.records,{persons:2,conversations:1,messages:1,decisions:1,adventures:1,attachments:1});
  assert.equal(counts.files,1);
  const db=new DatabaseSync(join(output,'memory.sqlite'));
  assert.equal(db.prepare("SELECT count(*) n FROM approvals WHERE decision_id='decision-1'").get().n,2);
  assert.equal(JSON.parse(db.prepare("SELECT data_json FROM records WHERE kind='decisions' AND id='decision-1'").get().data_json).status,'locked');
  assert.deepEqual(JSON.parse(db.prepare("SELECT data_json FROM records WHERE kind='adventures' AND id='idea-1'").get().data_json).phases,['idea','plan']);
  db.close();
  assert.deepEqual(new Uint8Array(await readFile(join(output,'media',id+'.png'))),fixture);
  await assert.rejects(restoreArchive(bundle,output),/already exists/);
});
test('Refuses media tampering, record tampering and broken links',async()=>{
  const pristine=await example();
  const media=structuredClone(pristine);media.media[0].bytes='AA==';
  await assert.rejects(verifyArchive(media),/checksum|mismatch/);
  const record=structuredClone(pristine);record.records.messages[0].body='Tampered';
  await assert.rejects(verifyArchive(record),/Record checksum/);
  const orphan=structuredClone(pristine);orphan.records.messages[0].attachment_ids=['missing'];
  orphan.records_sha256=await sha256(new TextEncoder().encode(JSON.stringify(orphan.records)));
  const folder=await mkdtemp(join(tmpdir(),'justelle-corrupt-'));
  const dest=join(folder,'unrestored');
  await assert.rejects(restoreArchive(orphan,dest),/Broken message attachment/);
  await assert.rejects(stat(dest),{code:'ENOENT'});
});

test('A portable restore rejects two confirmed changes to the same original agreement',async()=>{
  const archive=structuredClone(await example());
  const original=archive.records.decisions[0];
  archive.records.decisions.push(
    {...original,id:'change-one',replaces_id:'decision-1'},
    {...original,id:'change-two',replaces_id:'decision-1'}
  );
  archive.records_sha256=await sha256(new TextEncoder().encode(JSON.stringify(archive.records)));
  await assert.rejects(verifyArchive(archive),/Conflicting locked revisions/);
});

test('Nonlinear memory events and corrections survive offline restore; forged event chains fail',async()=>{
  const bundle=await example(),r=structuredClone(bundle.records);
  r.messages.push({...r.messages[0],id:'correction-1',body:'Fictional corrected note',attachment_ids:[],corrects_id:'message-1'});
  r.adventures[0]={...r.adventures[0],phase:'idea',phases:['memory','idea'],last_event_id:'event-2'};
  r.adventure_events=[
    {id:'event-1',adventure_id:'idea-1',phase:'memory',previous_id:null,author_id:'person-a',created_at:'2026-10-11T00:00:00Z'},
    {id:'event-2',adventure_id:'idea-1',phase:'idea',previous_id:'event-1',author_id:'person-b',created_at:'2026-10-11T00:00:01Z'}
  ];
  const archive=await createArchive(r,[{id,mime:'image/png',bytes:fixture}]);
  const output=join(await mkdtemp(join(tmpdir(),'justelle-events-')),'restored');
  await restoreArchive(archive,output);
  const db=new DatabaseSync(join(output,'memory.sqlite'));
  assert.equal(db.prepare("SELECT count(*) n FROM records WHERE kind='adventure_events'").get().n,2);db.close();
  r.adventure_events[0].previous_id='event-2';
  await assert.rejects(createArchive(r,[{id,mime:'image/png',bytes:fixture}]),/event history/);
});
