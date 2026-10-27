const phases=new Set([
  'config-read','config-parse','config-validation','source-revision',
  'runtime-config-write','target-config-write','root-dependencies',
  'functions-dependencies','app-build','deployment-config-stage',
  'firebase-deploy','rollback-source-checkout','release-precheck',
  'release-or-qualification-drill','shutdown-run-access','shutdown-hosting'
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

// Raw error details are inspected only in memory. The returned object is safe for public CI logs.
export function deploymentFailureDiagnostic(phase,error,{providerMutationMayHaveStarted=false}={}){
  const safePhase=phases.has(phase)?phase:'unknown';
  const exitCode=Number.isInteger(error?.code)?error.code:undefined;
  return {
    event:'justelle-deployment-failed',
    phase:safePhase,
    code:providerCode(error),
    providerStateNeedsReconciliation:Boolean(providerMutationMayHaveStarted),
    ...(exitCode===undefined?{}:{exitCode})
  };
}
