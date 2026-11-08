import {test} from 'node:test';
import assert from 'node:assert/strict';
import {requestAndValidateB2ObjectRetention} from '../hosting/functions/b2-store.mjs';
import {createHostedAcceptanceProgress,renderHostedAcceptanceFailureSummary} from '../hosting/hosted-acceptance-progress.mjs';

const request={bucket:'fictional-qualification-bucket',key:'qualification/fictional-backup.jmb',versionId:'fictional-version'};

async function summaryForFailure(client){
  const progress=createHostedAcceptanceProgress();
  progress.start('ENCRYPTED_BACKUP_DOWNLOAD_AND_RESTORE');
  progress.startSubcheck('BACKUP_OBJECT_RETENTION');
  await assert.rejects(requestAndValidateB2ObjectRetention(client,request),error=>{
    progress.failSubcheck('BACKUP_OBJECT_RETENTION',error);
    return true;
  });
  progress.failCurrent();
  progress.start('FINAL_TEARDOWN');
  progress.complete('FINAL_TEARDOWN');
  return renderHostedAcceptanceFailureSummary(progress);
}

test('B2 retention request failures emit only allowlisted status and error categories',async()=>{
  const sensitive='fictional-key-value fictional-version request-id raw-provider-message response-body';
  const providerError=Object.assign(new Error(`raw provider message ${sensitive}`),{
    name:'AccessDenied',Code:'AccessDenied',$metadata:{httpStatusCode:403,requestId:sensitive},
    responseBody:sensitive,Key:sensitive
  });
  let receivedInput;
  const summary=await summaryForFailure({send:async command=>{
    assert.equal(command.constructor.name,'GetObjectRetentionCommand');
    receivedInput=command.input;
    throw providerError;
  }});
  assert.deepEqual(receivedInput,{Bucket:request.bucket,Key:request.key,VersionId:request.versionId});
  assert.match(summary,/Failed subcheck: `BACKUP_OBJECT_RETENTION`/);
  assert.match(summary,/B2 object-retention request category: status `HTTP_403`; code `ACCESS_DENIED`/);
  for(const value of [request.bucket,request.key,request.versionId,'fictional-key-value','request-id',
    'raw-provider-message','response-body','AccessDenied'])assert.equal(summary.includes(value),false);
});

test('B2 retention response validation emits a fixed reason without response metadata',async()=>{
  const sensitive='fictional-version-id private-object-name encrypted-payload';
  const summary=await summaryForFailure({send:async()=>({
    Mode:'GOVERNANCE',RetainUntilDate:'2026-12-08T03:20:00Z',VersionId:sensitive,Key:sensitive
  })});
  assert.match(summary,/B2 object-retention response validation category: `RETAIN_UNTIL_DATE_NOT_DATE`/);
  for(const value of [sensitive,'2026-12-08T03:20:00Z','GOVERNANCE'])assert.equal(summary.includes(value),false);
});

test('B2 retention response validation reasons remain fixed and allowlisted',async()=>{
  const cases=[
    [{Mode:'COMPLIANCE',RetainUntilDate:new Date('2099-01-01T00:00:00Z')},'MODE_NOT_GOVERNANCE'],
    [{Mode:'GOVERNANCE'},'RETAIN_UNTIL_DATE_MISSING'],
    [{Mode:'GOVERNANCE',RetainUntilDate:new Date('invalid')},'RETAIN_UNTIL_DATE_INVALID'],
    [{Mode:'GOVERNANCE',RetainUntilDate:new Date(0)},'RETENTION_NOT_FUTURE']
  ];
  for(const [response,reason] of cases){
    const summary=await summaryForFailure({send:async()=>response});
    assert.match(summary,new RegExp('B2 object-retention response validation category: `'+reason+'`'));
  }
});

test('unknown B2 retention request details stay unknown and are not copied to output',async()=>{
  const sensitive='unknown-capability https://b2.invalid/private fictional-token';
  const providerError=Object.assign(new Error(sensitive),{
    name:sensitive,Code:sensitive,$metadata:{httpStatusCode:599,requestId:sensitive},responseBody:sensitive
  });
  const summary=await summaryForFailure({send:async()=>{throw providerError;}});
  assert.match(summary,/B2 object-retention request category: status `UNKNOWN`; code `UNKNOWN`/);
  assert.equal(summary.includes(sensitive),false);
  assert.equal(summary.includes('b2.invalid'),false);
  assert.equal(summary.includes('599'),false);
});
