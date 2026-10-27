const phases=new Set([
  'config-read','config-parse','config-validation','source-revision',
  'runtime-config-write','target-config-write','root-dependencies',
  'functions-dependencies','app-build','deployment-config-stage',
  'deployment-config-cleanup','firebase-deploy','rollback-source-checkout',
  'release-precheck','release-state-read','release-state-write',
  'release-or-qualification-drill','hosted-smoke-check','qualification-shutdown-check',
  'shutdown-run-access','shutdown-hosting'
]);

function textOf(value){
  if(typeof value==='string')return value.slice(-24000);
  if(Buffer.isBuffer(value))return value.toString('utf8').slice(-24000);
  return '';
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
