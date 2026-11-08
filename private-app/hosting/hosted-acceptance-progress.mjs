import {appendFile} from 'node:fs/promises';
import {getB2ObjectRetentionDiagnostic} from './functions/b2-store.mjs';

const checkIds=Object.freeze([
  'FICTIONAL_IDENTITIES_AND_MEMBERSHIP',
  'TWO_MEMBER_MESSAGES_AND_CORRECTIONS',
  'PROTECTED_MEDIA_AND_LIVE_VISION',
  'SYNTHETIC_IMAGE_COLOUR_DISCRIMINATION',
  'PLANNER_HISTORY_AND_PROTECTED_DOCUMENTS',
  'AI_PLAN_SOURCE_CREATION',
  'AI_PLAN_SUGGESTION_REQUEST',
  'AI_PLAN_SUGGESTION_RESPONSE_VALIDATION',
  'AI_PLAN_MEMBER_APPLY',
  'AI_PLAN_MEMBER_UNDO',
  'SCREENSHOT_SOURCE_CREATION',
  'SCREENSHOT_SUGGESTION_REQUEST',
  'SCREENSHOT_RESPONSE_VALIDATION',
  'OUTSIDER_AND_REVOKED_MEMBER_DENIAL',
  'AI_DISABLED_FAILURE_PRESERVATION',
  'ENCRYPTED_BACKUP_DOWNLOAD_AND_RESTORE',
  'FINAL_TEARDOWN'
]);
const allowedCheckIds=new Set(checkIds);
const subcheckIds=Object.freeze([
  'SUGGESTION_RESPONSE_JSON',
  'SUGGESTION_RESPONSE_PREVIEW_KIND',
  'SUGGESTION_RESPONSE_CHANGE_TYPE',
  'SUGGESTION_RESPONSE_SOURCE_ID',
  'SUGGESTION_RESPONSE_REVISION',
  'SUGGESTION_RESPONSE_PLAN_UNCHANGED',
  'BACKUP_TARGET_VALIDATION',
  'BACKUP_RECOVERY_KEY_VALIDATION',
  'BACKUP_LOCAL_WORKSPACE',
  'BACKUP_STORE_SETUP',
  'BACKUP_FIREBASE_SNAPSHOT',
  'BACKUP_ENCRYPTION',
  'BACKUP_SIZE_LIMIT',
  'BACKUP_RETENTION_PREFLIGHT',
  'BACKUP_UPLOAD',
  'BACKUP_OBJECT_RETENTION',
  'BACKUP_DOWNLOAD',
  'BACKUP_DOWNLOAD_CHECKSUM',
  'BACKUP_DECRYPTION_RESTORE',
  'BACKUP_RESTORED_RECORDS_READ',
  'BACKUP_RECORDS_MATCH',
  'BACKUP_VERIFIED_RESULT',
  'BACKUP_LOCAL_CLEANUP'
]);
const allowedSubcheckIds=new Set(subcheckIds);
const b2UploadErrorCategories=Object.freeze({
  AccessDenied:'ACCESS_DENIED',
  AuthorizationHeaderMalformed:'AUTHORIZATION_MALFORMED',
  BadDigest:'BAD_DIGEST',
  EntityTooLarge:'ENTITY_TOO_LARGE',
  IncompleteBody:'INCOMPLETE_BODY',
  InternalError:'INTERNAL_ERROR',
  InvalidAccessKeyId:'INVALID_ACCESS_KEY',
  InvalidArgument:'INVALID_ARGUMENT',
  InvalidBucketName:'INVALID_BUCKET_NAME',
  InvalidDigest:'INVALID_DIGEST',
  InvalidRequest:'INVALID_REQUEST',
  MissingContentLength:'MISSING_CONTENT_LENGTH',
  NoSuchBucket:'BUCKET_NOT_FOUND',
  RequestTimeTooSkewed:'REQUEST_TIME_SKEW',
  RequestTimeout:'REQUEST_TIMEOUT',
  ServiceUnavailable:'SERVICE_UNAVAILABLE',
  SignatureDoesNotMatch:'SIGNATURE_MISMATCH',
  SlowDown:'THROTTLED',
  XAmzContentSHA256Mismatch:'CHECKSUM_MISMATCH'
});
const allowedB2UploadStatuses=new Set([400,401,403,404,408,409,413,429,500,502,503,504]);
function classifyB2UploadError(error){
  let status='UNKNOWN',code='UNKNOWN';
  try{
    const value=error?.$metadata?.httpStatusCode;
    if(Number.isInteger(value)&&allowedB2UploadStatuses.has(value))status='HTTP_'+value;
    for(const candidate of [error?.Code,error?.code,error?.name])
      if(typeof candidate==='string'&&Object.hasOwn(b2UploadErrorCategories,candidate)){
        code=b2UploadErrorCategories[candidate];break;
      }
  }catch{}
  return Object.freeze({status,code});
}

export function createHostedAcceptanceProgress(){
  const entries=[];
  let active=null,activeSubcheck=null,ambiguousActive=false;
  function record(check,result){
    if(!allowedCheckIds.has(check)||!['PASS','FAIL','UNKNOWN'].includes(result))throw Error('Invalid acceptance diagnostic state');
    entries.push({check,result});
  }
  return Object.freeze({
    start(check){
      if(!allowedCheckIds.has(check)||active!==null||activeSubcheck!==null)throw Error('Invalid acceptance diagnostic stage');
      active=check;ambiguousActive=false;
    },
    startSubcheck(check){
      if(!['AI_PLAN_SUGGESTION_RESPONSE_VALIDATION','ENCRYPTED_BACKUP_DOWNLOAD_AND_RESTORE'].includes(active)||
        activeSubcheck!==null||!allowedSubcheckIds.has(check))
        throw Error('Invalid acceptance diagnostic subcheck');
      activeSubcheck=check;
    },
    completeSubcheck(check){
      if(!['AI_PLAN_SUGGESTION_RESPONSE_VALIDATION','ENCRYPTED_BACKUP_DOWNLOAD_AND_RESTORE'].includes(active)||
        activeSubcheck!==check||!allowedSubcheckIds.has(check))
        throw Error('Invalid acceptance diagnostic subcheck completion');
      entries.push({check:active,subcheck:check,result:'PASS'});activeSubcheck=null;
    },
    failSubcheck(check,error){
      if(!['AI_PLAN_SUGGESTION_RESPONSE_VALIDATION','ENCRYPTED_BACKUP_DOWNLOAD_AND_RESTORE'].includes(active)||
        activeSubcheck!==check||!allowedSubcheckIds.has(check))
        throw Error('Invalid acceptance diagnostic subcheck failure');
      const retentionFailure=check==='BACKUP_OBJECT_RETENTION'
        ?getB2ObjectRetentionDiagnostic(error):null;
      entries.push({check:active,subcheck:check,result:'FAIL',
        ...(check==='BACKUP_UPLOAD'?{failure:classifyB2UploadError(error)}:{}),
        ...(retentionFailure?{retentionFailure}:{})});activeSubcheck=null;
    },
    markUnknown(check){
      if(active!==check||!allowedCheckIds.has(check))throw Error('Invalid acceptance diagnostic ambiguity');
      ambiguousActive=true;
    },
    complete(check){
      if(active!==check||activeSubcheck!==null||!allowedCheckIds.has(check))throw Error('Invalid acceptance diagnostic completion');
      record(check,ambiguousActive?'UNKNOWN':'PASS');active=null;ambiguousActive=false;
    },
    failCurrent(){
      if(active!==null){
        record(active,'FAIL');
        if(activeSubcheck!==null)entries.push({check:active,subcheck:activeSubcheck,result:'FAIL'});
        active=null;activeSubcheck=null;
      }
    },
    snapshot(){
      const failedChecks=entries.filter(entry=>entry.result==='FAIL'&&!entry.subcheck).map(entry=>entry.check);
      const failedSubchecks=entries.filter(entry=>entry.result==='FAIL'&&entry.subcheck&&allowedSubcheckIds.has(entry.subcheck)).map(entry=>entry.subcheck);
      const failedSubcheckDetails=entries.filter(entry=>entry.result==='FAIL'&&entry.subcheck==='BACKUP_UPLOAD').map(entry=>Object.freeze({
        subcheck:'BACKUP_UPLOAD',status:entry.failure?.status??'UNKNOWN',code:entry.failure?.code??'UNKNOWN'
      }));
      const failedObjectRetentionDetails=entries.filter(entry=>entry.result==='FAIL'&&
        entry.subcheck==='BACKUP_OBJECT_RETENTION'&&entry.retentionFailure).map(entry=>Object.freeze({
          subcheck:'BACKUP_OBJECT_RETENTION',...entry.retentionFailure
        }));
      const completedChecks=entries.filter(entry=>entry.result==='PASS'&&!entry.subcheck&&entry.check!=='FINAL_TEARDOWN').map(entry=>entry.check);
      const teardown=entries.find(entry=>entry.check==='FINAL_TEARDOWN');
      return Object.freeze({
        outcome:'FAIL',
        failedChecks:Object.freeze(failedChecks.length?failedChecks:['UNKNOWN']),
        failedSubchecks:Object.freeze(failedSubchecks),
        failedSubcheckDetails:Object.freeze(failedSubcheckDetails),
        failedObjectRetentionDetails:Object.freeze(failedObjectRetentionDetails),
        lastCompletedCheck:completedChecks.at(-1)??'NONE',
        completedChecks:Object.freeze(completedChecks),
        teardownStatus:teardown?.result??'UNKNOWN'
      });
    }
  });
}

export function renderHostedAcceptanceFailureSummary(progress){
  const snapshot=progress.snapshot();
  const failed=snapshot.failedChecks.filter(check=>check==='UNKNOWN'||allowedCheckIds.has(check));
  const failedSubchecks=(snapshot.failedSubchecks??[]).filter(check=>allowedSubcheckIds.has(check));
  const uploadDetails=(snapshot.failedSubcheckDetails??[]).filter(detail=>detail?.subcheck==='BACKUP_UPLOAD'&&
    (detail.status==='UNKNOWN'||allowedB2UploadStatuses.has(Number(detail.status.slice?.(5))))&&
    ['UNKNOWN',...Object.values(b2UploadErrorCategories)].includes(detail.code));
  const retentionDetails=(snapshot.failedObjectRetentionDetails??[]).filter(detail=>{
    if(detail?.subcheck!=='BACKUP_OBJECT_RETENTION')return false;
    if(detail.kind==='REQUEST')return (detail.status==='UNKNOWN'||
      allowedB2UploadStatuses.has(Number(detail.status.slice?.(5))))&&
      ['UNKNOWN',...Object.values(b2UploadErrorCategories)].includes(detail.code);
    return detail.kind==='RESPONSE_VALIDATION'&&
      ['MODE_NOT_GOVERNANCE','RETAIN_UNTIL_DATE_MISSING','RETAIN_UNTIL_DATE_NOT_DATE',
        'RETAIN_UNTIL_DATE_INVALID','RETENTION_NOT_FUTURE'].includes(detail.reason);
  });
  const completed=snapshot.completedChecks.filter(check=>allowedCheckIds.has(check));
  const last=snapshot.lastCompletedCheck==='NONE'||allowedCheckIds.has(snapshot.lastCompletedCheck)?snapshot.lastCompletedCheck:'UNKNOWN';
  const teardown=['PASS','FAIL','UNKNOWN'].includes(snapshot.teardownStatus)?snapshot.teardownStatus:'UNKNOWN';
  return [
    '### Hosted fictional acceptance progress (safe diagnostic)',
    '',
    '- Outcome: FAIL',
    `- Failed stage (exact assertion not identified): ${failed.map(check=>'`'+check+'`').join(', ')||'`UNKNOWN`'}`,
    ...(failedSubchecks.length?[`- Failed subcheck: ${failedSubchecks.map(check=>'`'+check+'`').join(', ')}`]:[]),
    ...uploadDetails.map(detail=>`- B2 upload error category: status \`${detail.status}\`; code \`${detail.code}\``),
    ...retentionDetails.map(detail=>detail.kind==='REQUEST'
      ?`- B2 object-retention request category: status \`${detail.status}\`; code \`${detail.code}\``
      :`- B2 object-retention response validation category: \`${detail.reason}\``),
    `- Last completed check: ${'`'+last+'`'}`,
    `- Completed checks: ${completed.map(check=>'`'+check+'`').join(', ')||'`NONE`'}`,
    `- Final teardown: ${teardown}`,
    ''
  ].join('\n');
}

export async function appendHostedAcceptanceFailureSummary(summaryPath,progress){
  if(typeof summaryPath!=='string'||summaryPath.length===0)return false;
  await appendFile(summaryPath,renderHostedAcceptanceFailureSummary(progress),{encoding:'utf8'});
  return true;
}
