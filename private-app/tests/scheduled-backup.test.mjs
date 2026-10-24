import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {Readable} from 'node:stream';
import {createHash,randomBytes} from 'node:crypto';
import {runScheduledBackup} from '../hosting/scheduled-backup.mjs';
import {createB2Store,validateB2Retention,validateB2ObjectRetention} from '../hosting/functions/b2-store.mjs';
const id='00000000-0000-4000-8000-000000000001';
const image=Buffer.from('synthetic-original-image');
const records={persons:[{id:'person-a'},{id:'person-b'}],conversations:[{id:'conversation-shared'}],
  messages:[{id:'note',body:'Synthetic original',author_id:'person-a',kind:'person',conversation_id:'conversation-shared',attachment_ids:[id]},
    {id:'correction',body:'Synthetic correction',author_id:'person-a',kind:'person',conversation_id:'conversation-shared',attachment_ids:[],corrects_id:'note'},
    {id:'reply',body:'Synthetic AI',author_id:'ai-justelle',kind:'ai',conversation_id:'conversation-shared',source_message_id:'note',attachment_ids:[]}],
  decisions:[{id:'agreement',author_id:'person-b',conversation_id:'conversation-shared',status:'locked',locked_at:'2026-10-14T00:00:00Z',approvals:[{person_id:'person-a'},{person_id:'person-b'}]}],adventures:[],attachments:[{id,author_id:'person-a',mime:'image/png',size:image.length,sha256:createHash('sha256').update(image).digest('hex')}]};
const config={bucket:'justelle-qualification-backups',prefix:'qualification',recoveryKeyBase64:randomBytes(32).toString('base64')};
const source=()=>({records,media:[{id,mime:'image/png',stream:Readable.from([image])}]});
test('Scheduled backup uploads ciphertext and downloads/restores exact original history without Firebase',async()=>{
  let stored,closed=false;const calls=[];
  const store={verifyRetention:async()=>calls.push('retention'),put:async(n,p,size)=>{stored=await readFile(p);assert.equal(stored.length,size);calls.push('put');return 'fictional-version';},
    verifyObjectRetention:async(n,version)=>{assert.match(n,/^qualification\//);assert.equal(version,'fictional-version');calls.push('object-retention');},
    get:async()=>{calls.push('get');return Readable.from([stored]);},close:()=>{closed=true;}};
  const result=await runScheduledBackup({config,source:source(),store});
  assert.equal(result.verified,true);assert.deepEqual(calls,['retention','put','object-retention','get']);assert.equal(closed,true);
  assert.equal(stored.includes(image),false);assert.equal(stored.includes(Buffer.from('Synthetic original')),false);
});
test('Retention failure, upload failure and corrupt downloads cannot report a successful backup',async()=>{
  for(const fault of ['retention','upload','object-retention','corrupt']){
    let stored,uploaded=false,downloaded=false;
    const store={verifyRetention:async()=>{if(fault==='retention')throw Error('Retention missing');},put:async(n,p)=>{if(fault==='upload')throw Error('Upload unavailable');stored=await readFile(p);uploaded=true;},
      verifyObjectRetention:async()=>{if(fault==='object-retention')throw Error('Object lock missing');},
      get:async()=>{downloaded=true;const corrupt=Buffer.from(stored);corrupt[70]^=1;return Readable.from([corrupt]);}};
    await assert.rejects(runScheduledBackup({config,source:source(),store}));
    assert.equal(uploaded,['object-retention','corrupt'].includes(fault));
    assert.equal(downloaded,fault==='corrupt');
  }
});
test('B2 store cannot send credentials to an unrelated endpoint',()=>{
  assert.throws(()=>createB2Store({endpoint:'https://attacker.invalid',bucket:'fictional',keyId:'synthetic',applicationKey:'synthetic'}),/destination/);
});

test('B2 Object Lock preflight requires actual positive default governance retention',()=>{
 const set=(rule,enabled='Enabled')=>({ObjectLockConfiguration:{
   ObjectLockEnabled:enabled,Rule:{DefaultRetention:rule}}});
 for(const retention of [{Mode:'GOVERNANCE',Days:1},{Mode:'GOVERNANCE',Days:30},
   {Mode:'GOVERNANCE',Days:3000},{Mode:'GOVERNANCE',Years:2}])
   assert.equal(validateB2Retention(set(retention)),true);
 for(const candidate of [
   null,{},set({Mode:'COMPLIANCE',Days:30}),
   set({Mode:'GOVERNANCE',Days:30},'Disabled'),
   set({Mode:'GOVERNANCE',Days:0}),
   set({Mode:'GOVERNANCE',Days:3001}),
   set({Mode:'GOVERNANCE',Years:0}),
   set({Mode:'GOVERNANCE',Years:9}),
   set({Mode:'GOVERNANCE',Days:1,Years:2}),
   set({Mode:'GOVERNANCE'}),
   set({Mode:'GOVERNANCE',Days:'30'})
 ])assert.throws(()=>validateB2Retention(candidate),/B2/);
});
test('Invalid default retention prevents any remote snapshot upload',async()=>{
 let uploaded=false;
 const store={
   verifyRetention:async()=>validateB2Retention({ObjectLockConfiguration:{
     ObjectLockEnabled:'Enabled',Rule:{DefaultRetention:{Mode:'COMPLIANCE',Days:30}}}}),
   put:async()=>{uploaded=true;},get:async()=>{throw Error('Remote bytes should not be fetched');}
 };
 await assert.rejects(runScheduledBackup({config,source:source(),store}),/governance retention/);
 assert.equal(uploaded,false);
});

test('Uploaded B2 object must report its own valid future GOVERNANCE retention',()=>{
 const now=Date.parse('2026-10-21T12:00:00Z');
 assert.equal(validateB2ObjectRetention({Mode:'GOVERNANCE',RetainUntilDate:new Date(now+86400000)},now),true);
 for(const candidate of [
   null,{},
   {Mode:'COMPLIANCE',RetainUntilDate:new Date(now+86400000)},
   {Mode:'GOVERNANCE'},
   {Mode:'GOVERNANCE',RetainUntilDate:new Date('invalid')},
   {Mode:'GOVERNANCE',RetainUntilDate:new Date(now)},
   {Mode:'GOVERNANCE',RetainUntilDate:new Date(now-1000)},
   {Mode:'GOVERNANCE',RetainUntilDate:'2026-10-22T12:00:00Z'}
 ])assert.throws(()=>validateB2ObjectRetention(candidate,now),/object/);
});

test('Scheduled backup rejects crossed project B2 destinations before any remote contact',async()=>{
  const wrong=[
    {productionApproved:true,config:{...config}}, // fictional bucket in production
    {productionApproved:false,config:{...config,bucket:'justelle-production-backups-v1x',prefix:'production'}},
    {productionApproved:true,config:{...config,bucket:'justelle-production-backups-v1x'}},
    {productionApproved:false,config:{...config,prefix:'production'}},
    {productionApproved:false,config:{...config,bucket:'unrelated-bucket'}},
    {productionApproved:true,config:{...config,bucket:'justelle-qualification-backups',prefix:'production'}},
    {productionApproved:true,config:{...config,bucket:'justelle-production-backups/escape',prefix:'production'}},
    {productionApproved:true,config:{...config,bucket:undefined,prefix:'production'}}
  ];
  for(const entry of wrong){
    let contacted=false;
    const store={
      verifyRetention:async()=>{contacted=true;},
      put:async()=>{contacted=true;},
      get:async()=>{contacted=true;},
      close:()=>{contacted=true;}
    };
    await assert.rejects(runScheduledBackup({...entry,source:source(),store}),
      /B2 backup destination|Production requires|Fictional B2 bootstrap/);
    assert.equal(contacted,false);
  }
});

test('A distinct, correctly scoped production target still produces an independently restored archive',async()=>{
  const productionConfig={...config,bucket:'justelle-production-backups-v1x',prefix:'production'};
  let stored;const calls=[];
  const store={
    verifyRetention:async()=>calls.push('default'),
    put:async(key,path)=>{
      assert.match(key,/^production\//);
      stored=await readFile(path);calls.push('upload');return 'synthetic-production-version';
    },
    verifyObjectRetention:async(key,version)=>{
      assert.match(key,/^production\//);
      assert.equal(version,'synthetic-production-version');
      calls.push('object');
    },
    get:async()=>{calls.push('download');return Readable.from([stored]);}
  };
  const result=await runScheduledBackup({config:productionConfig,productionApproved:true,
    source:source(),store});
  assert.equal(result.verified,true);
  assert.deepEqual(calls,['default','upload','object','download']);
});
