const phases=new Set([
  'config-read','config-parse','config-validation','source-revision',
  'runtime-config-write','target-config-write','root-dependencies',
  'functions-dependencies','app-build','deployment-config-stage',
  'deployment-config-cleanup','firebase-deploy','rollback-source-checkout',
  'release-precheck','release-state-read','release-state-write',
  'release-or-qualification-drill','hosted-smoke-check','qualification-shutdown-check',
  'shutdown-run-access','shutdown-hosting'
]);

const firebaseCliErrorCategories=new Set([
  'UNKNOWN','HTTP_403','AUTHENTICATION_FAILED','QUOTA_EXCEEDED','RESOURCE_NOT_FOUND',
  'API_DISABLED','PERMISSION_DENIED',
  'SERVICE_USAGE_PERMISSION_DENIED','CLOUD_FUNCTIONS_PERMISSION_DENIED',
  'CLOUD_RUN_PERMISSION_DENIED','CLOUD_SCHEDULER_PERMISSION_DENIED',
  'CLOUD_BUILD_PERMISSION_DENIED','EVENTARC_PERMISSION_DENIED',
  'PUBSUB_PERMISSION_DENIED','ARTIFACT_REGISTRY_PERMISSION_DENIED',
  'IDENTITY_PERMISSION_DENIED','STORAGE_PERMISSION_DENIED',
  'FIREBASE_HOSTING_PERMISSION_DENIED',
  'SERVICE_USAGE_API_DISABLED','CLOUD_FUNCTIONS_API_DISABLED',
  'CLOUD_RUN_API_DISABLED','CLOUD_SCHEDULER_API_DISABLED',
  'CLOUD_BUILD_API_DISABLED','EVENTARC_API_DISABLED',
  'PUBSUB_API_DISABLED','ARTIFACT_REGISTRY_API_DISABLED',
  'IDENTITY_API_DISABLED','STORAGE_API_DISABLED','FIREBASE_HOSTING_API_DISABLED'
]);

const firebaseCliServiceMarkers=[
  ['SERVICE_USAGE',['serviceusage.googleapis.com','serviceusage.']],
  ['CLOUD_FUNCTIONS',['cloudfunctions.googleapis.com','cloudfunctions.']],
  ['CLOUD_RUN',['run.googleapis.com','run.services.']],
  ['CLOUD_SCHEDULER',['cloudscheduler.googleapis.com','cloudscheduler.']],
  ['CLOUD_BUILD',['cloudbuild.googleapis.com','cloudbuild.']],
  ['EVENTARC',['eventarc.googleapis.com','eventarc.']],
  ['PUBSUB',['pubsub.googleapis.com','pubsub.']],
  ['ARTIFACT_REGISTRY',['artifactregistry.googleapis.com','artifactregistry.']],
  ['IDENTITY',['iam.googleapis.com','iamcredentials.googleapis.com','iam.','iamcredentials.']],
  ['STORAGE',['storage.googleapis.com','storage.']],
  ['FIREBASE_HOSTING',['firebasehosting.googleapis.com','firebasehosting.']]
];

const firebaseCliErrorTextFields=new Set([
  'error','message','details','status','reason','statusmessage','cause',
  'code','permission','permissionname','service','servicename'
]);

function textOf(value){
  if(typeof value==='string')return value.slice(-24000);
  if(Buffer.isBuffer(value))return value.toString('utf8').slice(-24000);
  return '';
}


function hasCapturedText(value){
  if(typeof value==='string')return value.length>0;
  return Buffer.isBuffer(value)&&value.length>0;
}

function capturedByteLength(value){
  if(typeof value==='string')return Buffer.byteLength(value,'utf8');
  return Buffer.isBuffer(value)?value.length:0;
}

function firebaseCliOutputShape(error){
  const stdout=error?.stdout;
  const byteLength=capturedByteLength(stdout);
  if(byteLength===0)return 'empty';
  if(byteLength>64*1024)return 'too-large';
  const text=Buffer.isBuffer(stdout)?stdout.toString('utf8'):stdout;
  let parsed;
  try{parsed=JSON.parse(text.trim());}catch{return 'malformed-or-mixed';}
  if(!parsed||typeof parsed!=='object'||Array.isArray(parsed))return 'json-other';
  if(parsed.status==='error'&&(
    typeof parsed.error==='string'||
    (parsed.error&&typeof parsed.error==='object'&&!Array.isArray(parsed.error))
  ))return 'json-error';
  if(parsed.status==='success')return 'json-success';
  return 'json-other';
}

function collectFirebaseCliErrorText(value,parts,{depth=0}={}){
  if(depth>4||parts.length>=32)return;
  if(typeof value==='string'){
    const text=value.slice(0,8192);
    const trimmed=text.trim();
    if(depth<4&&Buffer.byteLength(trimmed,'utf8')<=16*1024&&
      (trimmed.startsWith('{')||trimmed.startsWith('['))){
      try{
        collectFirebaseCliErrorText(JSON.parse(trimmed),parts,{depth:depth+1});
        return;
      }catch{}
    }
    parts.push(text);
    return;
  }
  if(typeof value==='number'&&Number.isFinite(value)){
    parts.push(String(value));
    return;
  }
  if(Array.isArray(value)){
    for(const item of value.slice(0,16))collectFirebaseCliErrorText(item,parts,{depth:depth+1});
    return;
  }
  if(value&&typeof value==='object'){
    for(const [key,child] of Object.entries(value)){
      if(firebaseCliErrorTextFields.has(key.toLowerCase())){
        collectFirebaseCliErrorText(child,parts,{depth:depth+1});
      }
    }
  }
}

// Inspect only a bounded Firebase JSON error in memory. Never return its text.
function firebaseCliErrorCategory(error){
  if(firebaseCliOutputShape(error)!=='json-error')return 'UNKNOWN';
  const stdout=error?.stdout;
  const text=Buffer.isBuffer(stdout)?stdout.toString('utf8'):stdout;
  let envelope;
  try{envelope=JSON.parse(text.trim());}catch{return 'UNKNOWN';}
  const parts=[];
  collectFirebaseCliErrorText(envelope.error,parts);
  const details=parts.join('\n').toUpperCase();
  if(!details)return 'UNKNOWN';

  const matchingServices=firebaseCliServiceMarkers.filter(([,markers])=>
    markers.some(marker=>details.includes(marker.toUpperCase()))
  );
  // A generic error may mention several services. Do not attribute it to the
  // first marker when the provider output does not identify one unambiguously.
  const service=matchingServices.length===1?matchingServices[0][0]:undefined;

  let reason;
  if(/(?:SERVICE_DISABLED|API.{0,100}(?:NOT ENABLED|DISABLED)|SERVICE.{0,100}NOT ENABLED)/.test(details))reason='API_DISABLED';
  else if(/(?:PERMISSION_DENIED|DOES NOT HAVE PERMISSION|LACKS PERMISSION|NOT AUTHORIZED)/.test(details))reason='PERMISSION_DENIED';
  else if(/(?:HTTP(?:\s+ERROR)?\s*[:=]?\s*403|(?:STATUS|CODE)\s*[:=]\s*403|\b403\b)/.test(details))reason='HTTP_403';
  else if(/(?:UNAUTHENTICATED|INVALID_GRANT|NO CREDENTIALS|NOT LOGGED IN)/.test(details))reason='AUTHENTICATION_FAILED';
  else if(/(?:RESOURCE_EXHAUSTED|QUOTA_EXCEEDED|QUOTA.{0,40}EXCEEDED)/.test(details))reason='QUOTA_EXCEEDED';
  else if(/(?:NOT_FOUND|RESOURCE.{0,40}NOT FOUND)/.test(details))reason='RESOURCE_NOT_FOUND';
  else return 'UNKNOWN';

  const category=service&&['API_DISABLED','PERMISSION_DENIED'].includes(reason)
    ?`${service}_${reason}`:reason;
  return firebaseCliErrorCategories.has(category)?category:'UNKNOWN';
}

function firebaseCliProcessOutcome(error){
  if(error?.code==='ERR_CHILD_PROCESS_STDIO_MAXBUFFER')return 'output-limit';
  if(typeof error?.signal==='string'&&error.signal.length>0)return 'signal';
  if(Number.isInteger(error?.code))return 'exit-code';
  if(typeof error?.code==='string')return 'spawn-error';
  if(error?.killed===true)return 'killed';
  return 'unknown';
}

function providerCode(error){
  const status=Number(error?.statusCode??error?.status);
  if(status===401)return 'PROVIDER_AUTHENTICATION';
  if(status===403)return 'PROVIDER_PERMISSION';
  if(status===404)return 'PROVIDER_RESOURCE_NOT_FOUND';
  if(status===429)return 'PROVIDER_QUOTA';

  const details=[error?.code,error?.message,error?.stderr,error?.stdout]
    .map(textOf).join('\n').toUpperCase();
  if(/(?:HTTP(?:\s+ERROR)?\s*[:=]?\s*401|["']?CODE["']?\s*[:=]\s*401)/.test(details))return 'PROVIDER_AUTHENTICATION';
  if(/(?:HTTP(?:\s+ERROR)?\s*[:=]?\s*403|["']?CODE["']?\s*[:=]\s*403)/.test(details))return 'PROVIDER_PERMISSION';
  if(/(?:HTTP(?:\s+ERROR)?\s*[:=]?\s*404|["']?CODE["']?\s*[:=]\s*404)/.test(details))return 'PROVIDER_RESOURCE_NOT_FOUND';
  if(/(?:HTTP(?:\s+ERROR)?\s*[:=]?\s*429|["']?CODE["']?\s*[:=]\s*429)/.test(details))return 'PROVIDER_QUOTA';
  if(/(^|[^A-Z0-9_])SERVICE_DISABLED([^A-Z0-9_]|$)/.test(details))return 'PROVIDER_API_DISABLED';
  if(/(^|[^A-Z0-9_])UNAUTHENTICATED([^A-Z0-9_]|$)|INVALID_GRANT/.test(details))return 'PROVIDER_AUTHENTICATION';
  if(/(^|[^A-Z0-9_])PERMISSION_DENIED([^A-Z0-9_]|$)/.test(details))return 'PROVIDER_PERMISSION';
  if(/(^|[^A-Z0-9_])(RESOURCE_EXHAUSTED|QUOTA_EXCEEDED)([^A-Z0-9_]|$)/.test(details))return 'PROVIDER_QUOTA';
  if(/(^|[^A-Z0-9_])NOT_FOUND([^A-Z0-9_]|$)/.test(details))return 'PROVIDER_RESOURCE_NOT_FOUND';
  if(/(^|[^A-Z0-9_])INVALID_ARGUMENT([^A-Z0-9_]|$)/.test(details))return 'PROVIDER_CONFIGURATION_REJECTED';
  if(/(^|[^A-Z0-9_])(ENOTFOUND|EAI_AGAIN|ECONNRESET|ETIMEDOUT)([^A-Z0-9_]|$)/.test(details))return 'NETWORK_FAILURE';

  if(error?.code==='ERR_CHILD_PROCESS_STDIO_MAXBUFFER')return 'LOCAL_OUTPUT_LIMIT';
  if(error?.code==='ENOENT')return 'LOCAL_TOOL_OR_FILE_MISSING';
  if(error?.code==='EACCES'||error?.code==='EPERM')return 'LOCAL_ACCESS_DENIED';
  if(error instanceof SyntaxError)return 'CONFIG_INVALID';
  if(Number.isInteger(error?.code))return 'LOCAL_COMMAND_FAILED';
  return 'UNCLASSIFIED_FAILURE';
}

function firebaseDeployDetail(error){
  const details=[error?.message,error?.stderr,error?.stdout].map(textOf).join('\n').toUpperCase();
  if(/(?:SERVICE_DISABLED|API.{0,100}(?:NOT ENABLED|DISABLED)|SERVICE.{0,100}NOT ENABLED)/.test(details))return 'FIREBASE_API_DISABLED';
  if(/(?:PERMISSION_DENIED|DOES NOT HAVE PERMISSION|LACKS PERMISSION|NOT AUTHORIZED)/.test(details))return 'FIREBASE_PERMISSION_DENIED';
  if(/(?:UNAUTHENTICATED|INVALID_GRANT|NO CREDENTIALS|NOT LOGGED IN)/.test(details))return 'FIREBASE_AUTHENTICATION_FAILED';
  if(/(?:RESOURCE_EXHAUSTED|QUOTA_EXCEEDED|QUOTA.{0,40}EXCEEDED)/.test(details))return 'FIREBASE_QUOTA_EXCEEDED';
  if(/(?:HOSTING.{0,100}(?:SITE|TARGET)|(?:SITE|TARGET).{0,100}HOSTING).{0,100}(?:NOT FOUND|DOES NOT EXIST|NOT CONFIGURED)/.test(details))return 'FIREBASE_HOSTING_TARGET_UNAVAILABLE';
  if(/(?:SECRET.{0,100}(?:NOT FOUND|DOES NOT EXIST|NO ENABLED VERSION)|(?:NOT FOUND|DOES NOT EXIST).{0,100}SECRET)/.test(details))return 'FIREBASE_SECRET_UNAVAILABLE';
  if(/(?:INVALID.{0,60}FIREBASE.{0,40}CONFIG|FIREBASE\.JSON.{0,80}(?:INVALID|MISSING|UNREADABLE))/.test(details))return 'FIREBASE_CONFIG_INVALID';
  if(/(?:PREDEPLOY.{0,100}(?:ERROR|FAILED)|(?:ERROR|FAILED).{0,100}PREDEPLOY)/.test(details))return 'FIREBASE_PREDEPLOY_FAILED';
  if(/(?:CLOUD BUILD|FUNCTIONS?).{0,100}(?:BUILD|DEPLOY).{0,100}(?:FAILED|ERROR)|(?:BUILD|DEPLOY).{0,100}(?:FAILED|ERROR).{0,100}(?:CLOUD BUILD|FUNCTIONS?)/.test(details))return 'FIREBASE_FUNCTIONS_BUILD_FAILED';
  if(error?.code==='ERR_CHILD_PROCESS_STDIO_MAXBUFFER')return 'FIREBASE_CLI_OUTPUT_CAPTURE_LIMIT';
  if(Number.isInteger(error?.code)){
    return textOf(error?.stderr)||textOf(error?.stdout)
      ?'FIREBASE_CLI_OUTPUT_UNCLASSIFIED':'FIREBASE_CLI_EXIT_WITHOUT_OUTPUT';
  }
  return 'FIREBASE_CLI_FAILURE_UNCLASSIFIED';
}

// Raw error details are inspected only in memory. The returned object is safe for public CI logs.
export function deploymentFailureDiagnostic(phase,error,{providerMutationMayHaveStarted=false}={}){
  const safePhase=phases.has(phase)?phase:'unknown';
  const exitCode=Number.isInteger(error?.code)?error.code:undefined;
  return {
    event:'justelle-deployment-failed',
    phase:safePhase,
    code:providerCode(error),
    ...(safePhase==='firebase-deploy'?{detail:firebaseDeployDetail(error)}:{}),
    providerStateNeedsReconciliation:Boolean(providerMutationMayHaveStarted),
    ...(safePhase==='firebase-deploy'?{
      firebaseCliOutputShape:firebaseCliOutputShape(error),
      firebaseCliErrorCategory:firebaseCliErrorCategory(error),
      firebaseCliProcessOutcome:firebaseCliProcessOutcome(error),
      stdoutPresent:hasCapturedText(error?.stdout),
      stderrPresent:hasCapturedText(error?.stderr)
    }:{}),
    ...(exitCode===undefined?{}:{exitCode})
  };
}

export function createDeploymentFailureRecorder(){
  let first=null;
  return {
    capture(phase,error,options){
      if(first===null)first=deploymentFailureDiagnostic(phase,error,options);
      return first;
    },
    get first(){return first;}
  };
}

// Keep the first failure's safe description, but compute reconciliation from
// the final monotonic provider-mutation state after cleanup has also run.
export function finalizeDeploymentFailure(diagnostic,providerMutationMayHaveStarted=false){
  if(!diagnostic)return null;
  return {
    ...diagnostic,
    providerStateNeedsReconciliation:Boolean(
      diagnostic.providerStateNeedsReconciliation||providerMutationMayHaveStarted
    )
  };
}
