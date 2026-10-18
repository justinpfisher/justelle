import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {Readable} from 'node:stream';
import {createHash,randomBytes} from 'node:crypto';
import {runScheduledBackup} from '../hosting/scheduled-backup.mjs';
import {createB2Store} from '../hosting/functions/b2-store.mjs';
const id='00000000-0000-4000-8000-000000000001';
const image=Buffer.from('synthetic-original-image');
const records={persons:[{id:'person-a'},{id:'person-b'}],conversations:[{id:'conversation-shared'}],
  messages:[{id:'note',body:'Synthetic original',author_id:'person-a',kind:'person',conversation_id:'conversation-shared',attachment_ids:[id]},
    {id:'correction',body:'Synthetic correction',author_id:'person-a',kind:'person',conversation_id:'conversation-shared',attachment_ids:[],corrects_id:'note'},
    {id:'reply',body:'Synthetic AI',author_id:'ai-justelle',kind:'ai',conversation_id:'conversation-shared',source_message_id:'note',attachment_ids:[]}],
  decisions:[{id:'agreement',author_id:'person-b',conversation_id:'conversation-shared',status:'locked',locked_at:'2026-10-14T00:00:00Z',approvals:[{person_id:'person-a'},{person_id:'person-b'}]}],adventures:[],attachments:[{id,author_id:'person-a',mime:'image/png',size:image.length,sha256:createHash('sha256').update(image).digest('hex')}]};
const config={prefix:'fictional',recoveryKeyBase64:randomBytes(32).toString('base64')};
const source=()=>({records,media:[{id,mime:'image/png',stream:Readable.from([image])}]});
test('Scheduled backup uploads ciphertext and downloads/restores exact original history without Firebase',async()=>{
  let stored,closed=false;const calls=[];
  const store={verifyRetention:async()=>calls.push('retention'),put:async(n,p,size)=>{stored=await readFile(p);assert.equal(stored.length,size);calls.push('put');},
    get:async()=>{calls.push('get');return Readable.from([stored]);},close:()=>{closed=true;}};
  const result=await runScheduledBackup({config,source:source(),store});
  assert.equal(result.verified,true);assert.deepEqual(calls,['retention','put','get']);assert.equal(closed,true);
  assert.equal(stored.includes(image),false);assert.equal(stored.includes(Buffer.from('Synthetic original')),false);
});
test('Retention failure, upload failure and corrupt downloads cannot report a successful backup',async()=>{
  for(const fault of ['retention','upload','corrupt']){
    let stored,uploaded=false;
    const store={verifyRetention:async()=>{if(fault==='retention')throw Error('Retention missing');},put:async(n,p)=>{if(fault==='upload')throw Error('Upload unavailable');stored=await readFile(p);uploaded=true;},
      get:async()=>{const corrupt=Buffer.from(stored);corrupt[70]^=1;return Readable.from([corrupt]);}};
    await assert.rejects(runScheduledBackup({config,source:source(),store}));
    assert.equal(uploaded,fault==='corrupt');
  }
});
test('B2 store cannot send credentials to an unrelated endpoint',()=>{
  assert.throws(()=>createB2Store({endpoint:'https://attacker.invalid',bucket:'fictional',keyId:'synthetic',applicationKey:'synthetic'}),/destination/);
});
