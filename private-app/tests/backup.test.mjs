import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,readFile,writeFile,stat,readdir} from 'node:fs/promises';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {Readable} from 'node:stream';
import {createHash} from 'node:crypto';
import {DatabaseSync} from 'node:sqlite';
import {generateRecoveryKey,writeEncryptedBackup,restoreEncryptedBackup,writeDirectoryBackup} from '../memory/encrypted-backup.mjs';
const fixture=await readFile(new URL('./fictional-landscape.png',import.meta.url));
const digest=b=>createHash('sha256').update(b).digest('hex');
const id=i=>'00000000-0000-4000-8000-'+String(i).padStart(12,'0');
function records(count=1,bytes=fixture){return {
  persons:[{id:'person-a',label:'Fictional A'},{id:'person-b',label:'Fictional B'}],
  conversations:[{id:'conversation-shared',kind:'shared'}],
  messages:[{id:'note-1',body:'Fictional original memory',author_id:'person-a',kind:'person',conversation_id:'conversation-shared',attachment_ids:[id(1)],created_at:'2026-10-12T00:00:00Z'},
    {id:'note-2',body:'Fictional correction',author_id:'person-a',kind:'person',conversation_id:'conversation-shared',corrects_id:'note-1',attachment_ids:[],created_at:'2026-10-12T00:00:01Z'}],
  decisions:[{id:'plan-1',body:'Fictional agreed outing',author_id:'person-b',origin:'human',conversation_id:'conversation-shared',status:'locked',locked_at:'2026-10-12T00:00:05Z',approvals:[{person_id:'person-a',at:'2026-10-12T00:00:03Z'},{person_id:'person-b',at:'2026-10-12T00:00:05Z'}]}],
  adventures:[{id:'memory-1',title:'Fictional spontaneous memory',author_id:'person-b',conversation_id:'conversation-shared',phase:'memory',phases:['memory'],last_event_id:'event-1',source_message_id:'note-1'}],
  adventure_events:[{id:'event-1',adventure_id:'memory-1',phase:'memory',author_id:'person-b',previous_id:null,created_at:'2026-10-12T00:00:00Z'}],
  attachments:Array.from({length:count},(_,i)=>({id:id(i+1),name:'synthetic.png',mime:'image/png',size:bytes.length,sha256:digest(bytes),author_id:'person-a',preview_path:null}))
};}
function media(r,bytes=fixture){return r.attachments.map(a=>({id:a.id,mime:a.mime,stream:Readable.from([bytes])}));}
const folder=()=>mkdtemp(join(tmpdir(),'justelle-encrypted-test-'));
const absent=async p=>assert.rejects(stat(p),{code:'ENOENT'});

test('Encrypted independent restore preserves original bytes, authors, corrections, agreement approvals and memory events',async()=>{
  const dir=await folder(),key=generateRecoveryKey(),r=records(),backup=join(dir,'backup.jmb'),out=join(dir,'recovered');
  const result=await writeEncryptedBackup({records:r,media:media(r),key},backup);
  assert.equal(result.files,1);
  const ciphertext=await readFile(backup);
  assert.equal(ciphertext.includes(Buffer.from('Fictional original memory')),false);
  assert.equal(ciphertext.includes(fixture),false);
  const restored=await restoreEncryptedBackup(backup,key,out);
  assert.equal(restored.bytes,fixture.length);
  assert.deepEqual(await readFile(join(out,'media',id(1))),fixture);
  assert.deepEqual(JSON.parse(await readFile(join(out,'records.json'),'utf8')),r);
  const db=new DatabaseSync(join(out,'memory.sqlite'));
  assert.equal(db.prepare('SELECT count(*) n FROM approvals').get().n,2);
  assert.equal(db.prepare("SELECT count(*) n FROM records WHERE kind='adventure_events'").get().n,1);db.close();
  const roundtrip=join(dir,'roundtrip.jmb');
  await writeDirectoryBackup(out,key,roundtrip);
  await restoreEncryptedBackup(roundtrip,key,join(dir,'second-recovery'));
  await assert.rejects(restoreEncryptedBackup(backup,key,out),/already exists/);
  await assert.rejects(writeEncryptedBackup({records:r,media:media(r),key},backup),/already exists/);
});

test('Wrong key, tampering, truncation, reordering and trailing data fail before a recovery directory is published',async()=>{
  const dir=await folder(),key=generateRecoveryKey(),r=records(),backup=join(dir,'good.jmb');
  await writeEncryptedBackup({records:r,media:media(r),key},backup);
  const good=await readFile(backup),bad=Buffer.from(good);bad[60]^=1;
  const cases=[bad,good.subarray(0,good.length-1),good.subarray(0,good.length-70),Buffer.concat([good,Buffer.from([0,0,0,17])])];
  const header=Buffer.from('JUSTELLE-BACKUP-2\n').length+16;
  const firstEnd=header+4+good.readUInt32BE(header),secondEnd=firstEnd+4+good.readUInt32BE(firstEnd);
  cases.push(Buffer.concat([good.subarray(0,header),good.subarray(firstEnd,secondEnd),good.subarray(header,firstEnd),good.subarray(secondEnd)]));
  for(let i=0;i<cases.length;i++){
    const input=join(dir,'bad-'+i),output=join(dir,'out-'+i);await writeFile(input,cases[i]);
    await assert.rejects(restoreEncryptedBackup(input,key,output),/authentication|Truncated|Incomplete|Trailing/);await absent(output);
  }
  const wrong=join(dir,'wrong-key');await assert.rejects(restoreEncryptedBackup(backup,generateRecoveryKey(),wrong),/authentication/);await absent(wrong);
  assert.equal((await readdir(dir)).some(p=>p.startsWith('.')),false,'Failure staging is removed');
});

test('Streaming backup handles many images in bounded chunks and rejects missing or mismatched originals',async()=>{
  const dir=await folder(),key=generateRecoveryKey(),bytes=Buffer.alloc(2*1024*1024,42),r=records(12,bytes);
  async function* images(){for(const a of r.attachments){async function* chunks(){for(let i=0;i<bytes.length;i+=32768)yield bytes.subarray(i,i+32768);}yield {id:a.id,mime:a.mime,stream:chunks()};}}
  const backup=join(dir,'large.jmb');const written=await writeEncryptedBackup({records:r,media:images(),key},backup);
  assert.equal(written.bytes,24*1024*1024);assert.ok(written.frames>750);
  const restored=await restoreEncryptedBackup(backup,key,join(dir,'large-restored'));assert.equal(restored.files,12);
  assert.equal(digest(await readFile(join(dir,'large-restored','media',id(12)))),digest(bytes));
  const missing=join(dir,'missing');await assert.rejects(writeEncryptedBackup({records:r,media:[],key},missing),/Missing/);await absent(missing);
  const corrupt=join(dir,'corrupt');await assert.rejects(writeEncryptedBackup({records:records(),media:media(records(),Buffer.from('bad')),key},corrupt),/checksum|size/);await absent(corrupt);
});
