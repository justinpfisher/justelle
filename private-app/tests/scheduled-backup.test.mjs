import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,readFile,rm,writeFile} from 'node:fs/promises';
import {Readable} from 'node:stream';
import {createHash,randomBytes} from 'node:crypto';
import {createRequire} from 'node:module';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {runScheduledBackup} from '../hosting/scheduled-backup.mjs';
import {calculateContentMd5,createB2Store,validateB2Retention,validateB2ObjectRetention} from '../hosting/functions/b2-store.mjs';
import {createScheduledBackupTrigger} from '../hosting/functions/scheduled-backup-trigger.mjs';
import {createHostedAcceptanceProgress,renderHostedAcceptanceFailureSummary} from '../hosting/hosted-acceptance-progress.mjs';
const {S3Client}=createRequire(new URL('../hosting/functions/b2-store.mjs',import.meta.url))('@aws-sdk/client-s3');
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
    verifyObjectRetention:async(n,version)=>{assert.match(n,/^qualification\/[^/]+\.jmb$/);assert.equal(version,'fictional-version');calls.push('object-retention');},
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
      assert.match(key,/^production\/[^/]+\.jmb$/);
      stored=await readFile(path);calls.push('upload');return 'synthetic-production-version';
    },
    verifyObjectRetention:async(key,version)=>{
      assert.match(key,/^production\/[^/]+\.jmb$/);
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

const exerciseJob='firebase-schedule-encryptedBackup-northamerica-northeast1';
const exerciseSlot='2026-10-31T07:15:00Z';
const exercisePrefix='qualification/missed-run-check/v1/';
const fixtureVersion='fictional-exercise-version';

function exerciseFixture(t,options={}){
  const calls=[],claims=new Set();
  let sourceReads=0;
  let stagedArchive;
  let stagedVersion;
  const putStarted=Promise.withResolvers();
  const finishPut=options.blockPut?Promise.withResolvers():null;
  const fixtureSource=source();
  t.mock.method(S3Client.prototype,'send',async command=>{
    const input=command.input;
    const operation=command.constructor.name;
    calls.push({operation,input});
    assert.equal(input.Bucket,config.bucket);
    switch(operation){
      case 'GetObjectLockConfigurationCommand':return {ObjectLockConfiguration:{
        ObjectLockEnabled:'Enabled',Rule:{DefaultRetention:{Mode:'GOVERNANCE',Days:options.defaultDays??30}}
      }};
      case 'PutObjectCommand':{
        assert.ok(input.Key.startsWith(exercisePrefix));
        if(options.putError?.$metadata?.httpStatusCode){input.Body.destroy();throw options.putError;}
        const parts=[];
        for await(const chunk of input.Body)parts.push(chunk);
        stagedArchive=Buffer.concat(parts);
        if(!options.dropBeforeWrite)stagedVersion={Key:input.Key,VersionId:fixtureVersion,Size:stagedArchive.length};
        putStarted.resolve();
        if(finishPut)await finishPut.promise;
        if(options.putError)throw options.putError;
        return options.omitVersion?{}:{VersionId:fixtureVersion};
      }
      case 'ListObjectVersionsCommand':{
        assert.ok(input.Prefix.startsWith(exercisePrefix));
        assert.equal(input.MaxKeys,2);
        return options.list?.(stagedVersion)??{IsTruncated:false,Versions:stagedVersion?[stagedVersion]:[]};
      }
      case 'GetObjectRetentionCommand':
        assert.equal(input.Key,stagedVersion.Key);
        assert.equal(input.VersionId,fixtureVersion);
        return {Retention:{Mode:options.lockMode??'GOVERNANCE',RetainUntilDate:new Date(Date.now()+86400000)}};
      case 'GetObjectCommand':{
        assert.equal(input.Key,stagedVersion.Key);
        assert.equal(input.VersionId,fixtureVersion);
        const bytes=Buffer.from(stagedArchive);
        if(options.corrupt)bytes[70]^=1;
        if(options.changedRecords)fixtureSource.records.messages[0].body='Changed after snapshot';
        return {VersionId:options.downloadVersion??fixtureVersion,Body:Readable.from([bytes])};
      }
      default:throw Error('Unexpected synthetic operation');
    }
  });
  const claim=async name=>{
    if(claims.has(name))return false;
    claims.add(name);
    return true;
  };
  const run=(scheduledTime=exerciseSlot,overrides={})=>runScheduledBackup({config,
    store:createB2Store({...config,endpoint:'https://s3.test-region.backblazeb2.com',
      keyId:'fictional-id',applicationKey:'fictional-key'}),
    source:{then(resolve){sourceReads++;
      resolve(sourceReads===1?fixtureSource:source());}},
    qualificationExercise:{jobName:exerciseJob,scheduledTime,claim},...overrides});
  return {run,calls,claims,putStarted,finishPut,sourceReads:()=>sourceReads,
    operations:()=>calls.map(call=>call.operation)};
}

const reset=()=>Object.assign(Error('Synthetic lost response'),{code:'ECONNRESET'});
const expectedWrite=['GetObjectLockConfigurationCommand','PutObjectCommand'];
const expectedVerify=['GetObjectRetentionCommand','GetObjectCommand'];

test('Qualification exercise archives only in its exact prefix and verifies the acknowledged version',async t=>{
  const f=exerciseFixture(t);
  assert.equal((await f.run()).verified,true);
  assert.deepEqual(f.operations(),[...expectedWrite,...expectedVerify]);
  const key=f.calls[1].input.Key;
  assert.match(key,/^qualification\/missed-run-check\/v1\/[a-f0-9]{64}\.jmb$/);
  assert.equal(f.claims.has(key),true);
});

test('Qualification exercise reconciles an accepted PUT with a lost response without putting twice',async t=>{
  const f=exerciseFixture(t,{putError:reset()});
  assert.equal((await f.run()).verified,true);
  assert.deepEqual(f.operations(),[...expectedWrite,'ListObjectVersionsCommand',...expectedVerify]);
  assert.equal(f.calls[2].input.Prefix,f.calls[1].input.Key);
});

test('Qualification exercise reconciles a successful response without a version ID',async t=>{
  const f=exerciseFixture(t,{omitVersion:true});
  assert.equal((await f.run()).verified,true);
  assert.deepEqual(f.operations(),[...expectedWrite,'ListObjectVersionsCommand',...expectedVerify]);
});

test('Qualification exercise leaves a missing upload version unknown without a second PUT',async t=>{
  const f=exerciseFixture(t,{putError:reset(),dropBeforeWrite:true});
  await assert.rejects(f.run(),/upload outcome is unknown/);
  assert.deepEqual(f.operations(),[...expectedWrite,'ListObjectVersionsCommand']);
});

test('Qualification exercise rejects competing, truncated, deleted or prefix-only versions',async t=>{
  const replies={
    competing:v=>({IsTruncated:false,Versions:[v,{...v,VersionId:'competing-version'}]}),
    truncated:v=>({IsTruncated:true,Versions:[v]}),
    deleted:v=>({IsTruncated:false,Versions:[v],DeleteMarkers:[{Key:v.Key}]}),
    prefixOnly:v=>({IsTruncated:false,Versions:[{...v,Key:`${v.Key}.other`}]}),
  };
  for(const [name,list] of Object.entries(replies))await t.test(name,async t=>{
    const f=exerciseFixture(t,{putError:reset(),list});
    await assert.rejects(f.run(),/upload outcome is unknown/);
    assert.deepEqual(f.operations(),[...expectedWrite,'ListObjectVersionsCommand']);
  });
});

test('Qualification exercise does not reconcile a definitive permission denial',async t=>{
  const putError=Object.assign(Error('Synthetic denial'),{$metadata:{httpStatusCode:403}});
  const f=exerciseFixture(t,{putError});
  await assert.rejects(f.run(),putError);
  assert.deepEqual(f.operations(),expectedWrite);
});

test('Qualification exercise still requires exact version, governance lock, checksum and full restore',async t=>{
  const failures={
    lock:[{lockMode:'COMPLIANCE'},/retention/],
    version:[{downloadVersion:'different-version'},/version differs/],
    checksum:[{corrupt:true},/checksum mismatch/],
    restore:[{changedRecords:true},/Restored history differs/],
  };
  for(const [name,[options,error]] of Object.entries(failures))await t.test(name,async t=>{
    const f=exerciseFixture(t,{putError:reset(),...options});
    await assert.rejects(f.run(),error);
    assert.equal(f.operations().filter(operation=>operation==='PutObjectCommand').length,1);
  });
});

test('a concurrent duplicate cannot enter backup work and the next Toronto slot gets a different key',async t=>{
  const f=exerciseFixture(t,{blockPut:true});
  const first=f.run();
  try{
    await f.putStarted.promise;
    assert.deepEqual(await f.run('2026-10-31T03:15:00.000000-04:00'),{verified:false,duplicate:true});
    assert.equal(f.sourceReads(),1);
    assert.deepEqual(f.operations(),expectedWrite);
  }finally{f.finishPut.resolve();}
  assert.equal((await first).verified,true);
  assert.equal((await f.run('2026-11-01T03:15:00-05:00')).verified,true);
  assert.equal(f.claims.size,2);
  assert.equal(f.sourceReads(),2);
});

test('missing or ambiguous claims, invalid occurrences and production exercise input fail before source work',async t=>{
  const f=exerciseFixture(t);
  const productionConfig={...config,bucket:'justelle-production-backups-v1x',prefix:'production'};
  const claim=()=>{throw Error('Unexpected claim');};
  for(const [overrides,error] of [
    [{qualificationExercise:{}},/requires an authorized occurrence claim/],
    [{qualificationExercise:{jobName:exerciseJob,scheduledTime:exerciseSlot,claim:async()=>null}},/claim outcome is unknown/],
    [{qualificationExercise:{jobName:exerciseJob,scheduledTime:exerciseSlot,claim:async()=>{throw Error('Claim response lost');}}},/Claim response lost/],
    [{qualificationExercise:{jobName:exerciseJob,scheduledTime:'2026-02-31T08:15:00Z',claim}},/Invalid Qualification backup occurrence/],
    [{qualificationExercise:{jobName:'untrusted-job',scheduledTime:exerciseSlot,claim}},/Invalid Qualification backup occurrence/],
    [{productionApproved:true,config:productionConfig,qualificationExercise:{jobName:exerciseJob,scheduledTime:exerciseSlot,claim}},/requires an authorized occurrence claim/],
  ])await assert.rejects(f.run(exerciseSlot,overrides),error);
  assert.equal(f.sourceReads(),0);
  assert.deepEqual(f.calls,[]);
});

test('Qualification exercise verifies the exact 30-day lock before starting Firebase reads',async t=>{
  const f=exerciseFixture(t,{defaultDays:31});
  await assert.rejects(f.run(),/retention differs from the Qualification exercise/);
  assert.equal(f.sourceReads(),0);
  assert.deepEqual(f.operations(),['GetObjectLockConfigurationCommand']);
});

function scheduledTriggerFixture({slot='',environment='hosted-fictional',runBackup,loseClaimResponse=false}){
  const events=[],claimAttempts=[],claimed=new Set();
  const db={doc(path){
    assert.match(path,/^qualification_backup_occurrences\/[a-f0-9]{64}\.jmb$/);
    return {async create(marker){
      assert.deepEqual(marker,{started:true});
      claimAttempts.push(path);
      if(claimed.has(path))throw Object.assign(Error('Fictional duplicate'),{code:6});
      claimed.add(path);
      if(loseClaimResponse)throw Error('Fictional claim response lost');
    }};
  }};
  const log=line=>events.push(JSON.parse(line));
  const trigger=createScheduledBackupTrigger({schedule:'15 3 * * *',timeZone:'America/Toronto',retryCount:0},{
    runtime:()=>({roomId:'fictional-room',environment}),getFirestore:()=>db,getBucket:()=>({}),readConfig:()=>config,
    getExerciseSlot:()=>slot,version:'synthetic-version',runBackup,logger:{info:log,error:log}
  });
  const invoke=async ({job=exerciseJob,time}={})=>{
    const headers={'x-cloudscheduler-jobname':job,'x-cloudscheduler-scheduletime':time};
    let code;
    await trigger({header:name=>headers[name.toLowerCase()]},{status(value){code=value;return {send(){}};}});
    return code;
  };
  return {invoke,trigger,events,claimAttempts,claimed};
}

test('the real scheduled HTTP adapter leaves default Qualification and Production backups unchanged',async()=>{
  for(const [environment,slot] of [['hosted-fictional',''],['production',exerciseSlot]]){
    const received=[];
    const f=scheduledTriggerFixture({environment,slot,runBackup:async parameters=>{
      received.push(parameters);return {verified:true};
    }});
    assert.equal(await f.invoke({job:'ordinary invoker'}),200);
    assert.equal(received[0].productionApproved,environment==='production');
    assert.equal(received[0].qualificationExercise,null);
    assert.deepEqual(f.claimAttempts,[]);
    assert.deepEqual(f.events,[{event:'encrypted_backup_verified',version:'synthetic-version'}]);
    assert.equal(f.trigger.__endpoint.scheduleTrigger.schedule,'15 3 * * *');
    assert.equal(f.trigger.__endpoint.scheduleTrigger.timeZone,'America/Toronto');
    assert.equal(f.trigger.__endpoint.scheduleTrigger.retryConfig.retryCount,0);
  }
});

test('the scheduled callback claims one equivalent slot before work and verifies an accepted PUT after response loss',async t=>{
  const b2=exerciseFixture(t,{putError:reset(),blockPut:true});
  const f=scheduledTriggerFixture({slot:exerciseSlot,runBackup:parameters=>b2.run(exerciseSlot,parameters)});
  const first=f.invoke({time:exerciseSlot});
  try{
    await b2.putStarted.promise;
    assert.equal(await f.invoke({time:'2026-10-31T03:15:00.000000-04:00'}),500);
    assert.deepEqual(f.events,[]);
    assert.equal(f.claimed.size,1);
    assert.equal(f.claimAttempts.length,2);
    assert.equal(f.claimAttempts[0],f.claimAttempts[1]);
    assert.equal(b2.sourceReads(),1);
    assert.deepEqual(b2.operations(),expectedWrite);
  }finally{b2.finishPut.resolve();}
  assert.equal(await first,200);
  assert.deepEqual(b2.operations(),[...expectedWrite,'ListObjectVersionsCommand',...expectedVerify]);
  const archiveName=b2.calls[1].input.Key;
  assert.equal(f.claimAttempts[0],`qualification_backup_occurrences/${archiveName.split('/').at(-1)}`);
  assert.deepEqual(f.events,[{event:'encrypted_backup_verified',version:'synthetic-version'}]);
});

test('an active exercise rejects missing raw headers, an unapproved slot and direct SDK invocation',async()=>{
  const f=scheduledTriggerFixture({slot:exerciseSlot,runBackup:async()=>assert.fail('Unexpected backup work')});
  assert.equal(await f.invoke(),500);
  assert.equal(await f.invoke({job:'other-job',time:exerciseSlot}),500);
  assert.equal(await f.invoke({time:'2026-11-01T08:15:00Z'}),500);
  await assert.rejects(f.trigger.run({jobName:exerciseJob,scheduleTime:exerciseSlot}),/Encrypted backup failed/);
  assert.deepEqual(f.claimAttempts,[]);
  assert.deepEqual(f.events,Array(4).fill({event:'encrypted_backup_failed',version:'synthetic-version'}));
});

test('the scheduled callback fails closed after an accepted claim loses its response',async t=>{
  const b2=exerciseFixture(t);
  const f=scheduledTriggerFixture({slot:exerciseSlot,loseClaimResponse:true,runBackup:parameters=>b2.run(exerciseSlot,parameters)});
  assert.equal(await f.invoke({time:exerciseSlot}),500);
  assert.equal(await f.invoke({time:exerciseSlot}),500);
  assert.equal(f.claimed.size,1);
  assert.equal(b2.sourceReads(),0);
  assert.deepEqual(b2.operations(),[]);
  assert.deepEqual(f.events,[{event:'encrypted_backup_failed',version:'synthetic-version'}]);
});
