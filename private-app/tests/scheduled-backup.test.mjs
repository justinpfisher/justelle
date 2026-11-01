import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,readFile,rm,writeFile} from 'node:fs/promises';
import {Readable} from 'node:stream';
import {createHash,randomBytes} from 'node:crypto';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {runScheduledBackup} from '../hosting/scheduled-backup.mjs';
import {calculateContentMd5,createB2Store,validateB2Retention,validateB2ObjectRetention} from '../hosting/functions/b2-store.mjs';
import {createHostedAcceptanceProgress,renderHostedAcceptanceFailureSummary} from '../hosting/hosted-acceptance-progress.mjs';
const id='00000000-0000-4000-8000-000000000001';
const image=Buffer.from('synthetic-original-image');
const records={persons:[{id:'person-a'},{id:'person-b'}],conversations:[{id:'conversation-shared'}],
  messages:[{id:'note',body:'Synthetic original',author_id:'person-a',kind:'person',conversation_id:'conversation-shared',attachment_ids:[id]},
    {id:'correction',body:'Synthetic correction',author_id:'person-a',kind:'person',conversation_id:'conversation-shared',attachment_ids:[],corrects_id:'note'},
    {id:'reply',body:'Synthetic AI',author_id:'ai-justelle',kind:'ai',conversation_id:'conversation-shared',source_message_id:'note',attachment_ids:[]}],
  decisions:[{id:'agreement',author_id:'person-b',conversation_id:'conversation-shared',status:'locked',locked_at:'2026-10-14T00:00:00Z',approvals:[{person_id:'person-a'},{person_id:'person-b'}]}],adventures:[],attachments:[{id,author_id:'person-a',mime:'image/png',size:image.length,sha256:createHash('sha256').update(image).digest('hex')}]};
const config={bucket:'justelle-qualification-backups',prefix:'qualification',recoveryKeyBase64:randomBytes(32).toString('base64')};
const source=()=>({records:structuredClone(records),media:[{id,mime:'image/png',stream:Readable.from([image])}]});
test('B2 upload checksum is the base64 MD5 of the exact staged encrypted bytes',async()=>{
  const directory=await mkdtemp(join(tmpdir(),'justelle-b2-checksum-'));
  try{
    const path=join(directory,'synthetic-encrypted-backup.jmb');
    const bytes=Buffer.from('fictional encrypted backup bytes');await writeFile(path,bytes);
    assert.equal(await calculateContentMd5(path),createHash('md5').update(bytes).digest('base64'));
  }finally{await rm(directory,{recursive:true,force:true});}
});
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
  const expectedSubcheck={retention:'BACKUP_RETENTION_PREFLIGHT',upload:'BACKUP_UPLOAD',
    'object-retention':'BACKUP_OBJECT_RETENTION',corrupt:'BACKUP_DOWNLOAD_CHECKSUM'};
  for(const fault of Object.keys(expectedSubcheck)){
    const progress=createHostedAcceptanceProgress();progress.start('ENCRYPTED_BACKUP_DOWNLOAD_AND_RESTORE');
    let stored,uploaded=false,downloaded=false;
    const store={verifyRetention:async()=>{if(fault==='retention')throw Error('Retention missing');},put:async(n,p)=>{if(fault==='upload')throw Error('Upload unavailable');stored=await readFile(p);uploaded=true;},
      verifyObjectRetention:async()=>{if(fault==='object-retention')throw Error('Object lock missing');},
      get:async()=>{downloaded=true;const corrupt=Buffer.from(stored);corrupt[70]^=1;return Readable.from([corrupt]);}};
    await assert.rejects(runScheduledBackup({config,source:source(),store,progress}));
    assert.equal(uploaded,['object-retention','corrupt'].includes(fault));
    assert.equal(downloaded,fault==='corrupt');
    progress.failCurrent();progress.start('FINAL_TEARDOWN');progress.complete('FINAL_TEARDOWN');
    assert.match(renderHostedAcceptanceFailureSummary(progress),new RegExp('Failed subcheck: `'+expectedSubcheck[fault]+'`'));
  }
});

test('Backup failure summary names the fixed failing stage without exposing error or archive data',async()=>{
  const sensitive='owner@example.test private-room recovery-key ciphertext';
  const progress=createHostedAcceptanceProgress();
  progress.start('ENCRYPTED_BACKUP_DOWNLOAD_AND_RESTORE');
  const store={verifyRetention:async()=>{},put:async()=>{throw Error('Upload failed '+sensitive);},close(){}};
  await assert.rejects(runScheduledBackup({config,source:source(),store,progress}),/Upload failed/);
  progress.failCurrent();
  progress.start('FINAL_TEARDOWN');progress.complete('FINAL_TEARDOWN');
  const summary=renderHostedAcceptanceFailureSummary(progress);
  assert.match(summary,/Failed subcheck: `BACKUP_UPLOAD`/);
  for(const value of ['owner@example.test','private-room','recovery-key','ciphertext'])assert.equal(summary.includes(value),false);
  assert.equal(summary.includes(sensitive),false);
});

test('B2 upload error summary emits only allowlisted status and error categories',async()=>{
  const sensitive='owner@example.test private-room https://b2.invalid/object app-key ciphertext request-id';
  const progress=createHostedAcceptanceProgress();progress.start('ENCRYPTED_BACKUP_DOWNLOAD_AND_RESTORE');
  const providerError=Object.assign(new Error('raw provider text '+sensitive),{
    name:'InvalidRequest',Code:'InvalidRequest',$metadata:{httpStatusCode:400,requestId:sensitive},
    responseBody:'secret response '+sensitive
  });
  const store={verifyRetention:async()=>{},put:async()=>{throw providerError;},close(){}};
  await assert.rejects(runScheduledBackup({config,source:source(),store,progress}));progress.failCurrent();
  progress.start('FINAL_TEARDOWN');progress.complete('FINAL_TEARDOWN');
  const summary=renderHostedAcceptanceFailureSummary(progress);
  assert.match(summary,/Failed subcheck: `BACKUP_UPLOAD`/);
  assert.match(summary,/B2 upload error category: status `HTTP_400`; code `INVALID_REQUEST`/);
  assert.equal(summary.includes(sensitive),false);
  for(const value of ['owner@example.test','private-room','b2.invalid','app-key','ciphertext','request-id','raw provider text','secret response'])
    assert.equal(summary.includes(value),false);
});

test('Unknown B2 upload errors remain unknown and do not emit arbitrary provider fields',async()=>{
  const secret='fictional-token-value';
  const progress=createHostedAcceptanceProgress();progress.start('ENCRYPTED_BACKUP_DOWNLOAD_AND_RESTORE');
  const providerError=Object.assign(new Error(secret),{
    name:secret,Code:secret,$metadata:{httpStatusCode:599,requestId:secret},responseBody:secret
  });
  const store={verifyRetention:async()=>{},put:async()=>{throw providerError;},close(){}};
  await assert.rejects(runScheduledBackup({config,source:source(),store,progress}));progress.failCurrent();
  progress.start('FINAL_TEARDOWN');progress.complete('FINAL_TEARDOWN');
  const summary=renderHostedAcceptanceFailureSummary(progress);
  assert.match(summary,/B2 upload error category: status `UNKNOWN`; code `UNKNOWN`/);
  assert.equal(summary.includes(secret),false);
});

test('A changed in-memory source fails at the restored-record comparison subcheck',async()=>{
  const fixture=source();let stored;
  const progress=createHostedAcceptanceProgress();progress.start('ENCRYPTED_BACKUP_DOWNLOAD_AND_RESTORE');
  const store={verifyRetention:async()=>{},put:async(_name,path)=>{stored=await readFile(path);return 'fictional-version';},
    verifyObjectRetention:async()=>{},get:async()=>{
      fixture.records.messages[0].body='Changed after snapshot';
      return Readable.from([stored]);
    }};
  await assert.rejects(runScheduledBackup({config,source:fixture,store,progress}),/Restored history differs/);
  progress.failCurrent();progress.start('FINAL_TEARDOWN');progress.complete('FINAL_TEARDOWN');
  assert.match(renderHostedAcceptanceFailureSummary(progress),/Failed subcheck: `BACKUP_RECORDS_MATCH`/);
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
