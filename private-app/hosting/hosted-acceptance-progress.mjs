import {appendFile} from 'node:fs/promises';

const checkIds=Object.freeze([
  'FICTIONAL_IDENTITIES_AND_MEMBERSHIP',
  'TWO_MEMBER_MESSAGES_AND_CORRECTIONS',
  'PROTECTED_MEDIA_AND_LIVE_VISION',
  'SYNTHETIC_IMAGE_COLOUR_DISCRIMINATION',
  'PLANNER_HISTORY_AND_PROTECTED_DOCUMENTS',
  'AI_PLAN_SUGGESTION_AND_APPLY_UNDO',
  'OUTSIDER_AND_REVOKED_MEMBER_DENIAL',
  'AI_DISABLED_FAILURE_PRESERVATION',
  'ENCRYPTED_BACKUP_DOWNLOAD_AND_RESTORE',
  'FINAL_TEARDOWN'
]);
const allowedCheckIds=new Set(checkIds);

export function createHostedAcceptanceProgress(){
  const entries=[];
  let active=null,ambiguousActive=false;
  function record(check,result){
    if(!allowedCheckIds.has(check)||!['PASS','FAIL','UNKNOWN'].includes(result))throw Error('Invalid acceptance diagnostic state');
    entries.push({check,result});
  }
  return Object.freeze({
    start(check){
      if(!allowedCheckIds.has(check)||active!==null)throw Error('Invalid acceptance diagnostic stage');
      active=check;ambiguousActive=false;
    },
    markUnknown(check){
      if(active!==check||!allowedCheckIds.has(check))throw Error('Invalid acceptance diagnostic ambiguity');
      ambiguousActive=true;
    },
    complete(check){
      if(active!==check||!allowedCheckIds.has(check))throw Error('Invalid acceptance diagnostic completion');
      record(check,ambiguousActive?'UNKNOWN':'PASS');active=null;ambiguousActive=false;
    },
    failCurrent(){
      if(active!==null){record(active,'FAIL');active=null;}
    },
    snapshot(){
      const failedChecks=entries.filter(entry=>entry.result==='FAIL').map(entry=>entry.check);
      const completedChecks=entries.filter(entry=>entry.result==='PASS'&&entry.check!=='FINAL_TEARDOWN').map(entry=>entry.check);
      const teardown=entries.find(entry=>entry.check==='FINAL_TEARDOWN');
      return Object.freeze({
        outcome:'FAIL',
        failedChecks:Object.freeze(failedChecks.length?failedChecks:['UNKNOWN']),
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
  const completed=snapshot.completedChecks.filter(check=>allowedCheckIds.has(check));
  const last=snapshot.lastCompletedCheck==='NONE'||allowedCheckIds.has(snapshot.lastCompletedCheck)?snapshot.lastCompletedCheck:'UNKNOWN';
  const teardown=['PASS','FAIL','UNKNOWN'].includes(snapshot.teardownStatus)?snapshot.teardownStatus:'UNKNOWN';
  return [
    '### Hosted fictional acceptance progress (safe diagnostic)',
    '',
    '- Outcome: FAIL',
    `- Failed stage (exact assertion not identified): ${failed.map(check=>'`'+check+'`').join(', ')||'`UNKNOWN`'}`,
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
