import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createDeploymentFailureRecorder,deploymentFailureDiagnostic,finalizeDeploymentFailure} from '../hosting/deployment-diagnostics.mjs';

test('Deployment diagnostics classify known provider failures without returning their text',()=>{
  const secret='SENSITIVE_CONFIG_PASSWORD_38a1';
  for(const [raw,code] of [
    ['SERVICE_DISABLED: '+secret,'PROVIDER_API_DISABLED'],
    ['PERMISSION_DENIED: '+secret,'PROVIDER_PERMISSION'],
    ['UNAUTHENTICATED '+secret,'PROVIDER_AUTHENTICATION'],
    ['HTTP Error: 403 '+secret,'PROVIDER_PERMISSION'],
    ['HTTP Error: 401 '+secret,'PROVIDER_AUTHENTICATION'],
    ['RESOURCE_EXHAUSTED '+secret,'PROVIDER_QUOTA'],
    ['NOT_FOUND '+secret,'PROVIDER_RESOURCE_NOT_FOUND'],
    ['INVALID_ARGUMENT '+secret,'PROVIDER_CONFIGURATION_REJECTED'],
    ['ETIMEDOUT '+secret,'NETWORK_FAILURE']
  ]){
    const result=deploymentFailureDiagnostic('firebase-deploy',{message:raw,stderr:raw,code:1},{providerMutationMayHaveStarted:true});
    assert.equal(result.code,code);
    assert.equal(result.phase,'firebase-deploy');
    assert.equal(result.providerStateNeedsReconciliation,true);
    assert.equal(result.exitCode,1);
    assert.equal(JSON.stringify(result).includes(secret),false);
    assert.equal(JSON.stringify(result).includes(raw),false);
  }
});

test('Local failures and malformed phases produce only fixed diagnostic enums',()=>{
  assert.deepEqual(deploymentFailureDiagnostic('config-parse',new SyntaxError('secret=never-log')),
    {event:'justelle-deployment-failed',phase:'config-parse',code:'CONFIG_INVALID',providerStateNeedsReconciliation:false});
  assert.deepEqual(deploymentFailureDiagnostic('source-revision',{code:'ENOENT',message:'private/path'}),
    {event:'justelle-deployment-failed',phase:'source-revision',code:'LOCAL_TOOL_OR_FILE_MISSING',providerStateNeedsReconciliation:false});
  const unknown=deploymentFailureDiagnostic('private-email@example.com',{message:'secret=never-log'});
  assert.equal(unknown.phase,'unknown');
  assert.equal(unknown.code,'UNCLASSIFIED_FAILURE');
  assert.equal(JSON.stringify(unknown).includes('private-email'),false);
  assert.equal(JSON.stringify(unknown).includes('never-log'),false);
});

test('Provider mutation uncertainty is explicit even when the provider error is unclassified',()=>{
  const result=deploymentFailureDiagnostic('firebase-deploy',{message:'provider returned opaque failure'},
    {providerMutationMayHaveStarted:true});
  assert.equal(result.code,'UNCLASSIFIED_FAILURE');
  assert.equal(result.providerStateNeedsReconciliation,true);
});

test('First failure phase and category survive later rollback or shutdown errors',()=>{
  const recorder=createDeploymentFailureRecorder();
  recorder.capture('firebase-deploy',{stderr:'PERMISSION_DENIED private-password-value',code:1},
    {providerMutationMayHaveStarted:true});
  recorder.capture('shutdown-hosting',{stderr:'cleanup private-password-value',code:1},
    {providerMutationMayHaveStarted:true});
  assert.deepEqual(recorder.first,{
    event:'justelle-deployment-failed',phase:'firebase-deploy',code:'PROVIDER_PERMISSION',detail:'FIREBASE_PERMISSION_DENIED',
    providerStateNeedsReconciliation:true,firebaseCliOutputShape:'empty',firebaseCliErrorCategory:'UNKNOWN',
    firebaseCliProcessOutcome:'exit-code',stdoutPresent:false,stderrPresent:true,exitCode:1
  });
  assert.equal(JSON.stringify(recorder.first).includes('private-password-value'),false);
});

test('Final reconciliation flag includes later provider recovery mutation while retaining first failure',()=>{
  const secret='SENSITIVE_RECOVERY_SECRET_91c2';
  const recorder=createDeploymentFailureRecorder();
  recorder.capture('root-dependencies',{code:1,stderr:'local install failed '+secret},
    {providerMutationMayHaveStarted:false});
  recorder.capture('shutdown-hosting',{code:1,stderr:'provider cleanup failed '+secret},
    {providerMutationMayHaveStarted:true});
  const final=finalizeDeploymentFailure(recorder.first,true);
  assert.deepEqual(final,{
    event:'justelle-deployment-failed',phase:'root-dependencies',code:'LOCAL_COMMAND_FAILED',
    providerStateNeedsReconciliation:true,exitCode:1
  });
  assert.equal(JSON.stringify(final).includes(secret),false);
  assert.equal(JSON.stringify(final).includes('provider cleanup failed'),false);
});

test('Firebase deployment details are fixed safe codes for common failures and opaque child output',()=>{
  const secret='HOSTED_CONFIG_PASSWORD_7a91';
  const cases=[
    ['API SERVICE_DISABLED '+secret,'FIREBASE_API_DISABLED'],
    ['PERMISSION_DENIED '+secret,'FIREBASE_PERMISSION_DENIED'],
    ['No credentials '+secret,'FIREBASE_AUTHENTICATION_FAILED'],
    ['RESOURCE_EXHAUSTED '+secret,'FIREBASE_QUOTA_EXCEEDED'],
    ['Firebase Hosting site does not exist '+secret,'FIREBASE_HOSTING_TARGET_UNAVAILABLE'],
    ['Secret version does not exist '+secret,'FIREBASE_SECRET_UNAVAILABLE'],
    ['firebase.json is invalid '+secret,'FIREBASE_CONFIG_INVALID'],
    ['predeploy error '+secret,'FIREBASE_PREDEPLOY_FAILED'],
    ['Cloud Build deployment failed '+secret,'FIREBASE_FUNCTIONS_BUILD_FAILED']
  ];
  for(const [stderr,detail] of cases){
    const result=deploymentFailureDiagnostic('firebase-deploy',{code:1,stderr});
    assert.equal(result.detail,detail);
    assert.equal(JSON.stringify(result).includes(secret),false);
    assert.equal(JSON.stringify(result).includes(stderr),false);
  }
  assert.equal(deploymentFailureDiagnostic('firebase-deploy',{code:1,stderr:'opaque '+secret}).detail,
    'FIREBASE_CLI_OUTPUT_UNCLASSIFIED');
  assert.equal(deploymentFailureDiagnostic('firebase-deploy',{code:1}).detail,
    'FIREBASE_CLI_EXIT_WITHOUT_OUTPUT');
  assert.equal(deploymentFailureDiagnostic('firebase-deploy',{message:'opaque '+secret}).detail,
    'FIREBASE_CLI_FAILURE_UNCLASSIFIED');
});


test('Firebase CLI JSON errors expose only a safe envelope and process summary',()=>{
  const secrets=['fixture-password-DO-NOT-LOG','private.person@example.test','projects/private-project-id','ya29.fixture-token'];
  const message='PERMISSION_DENIED '+secrets.join(' ');
  const result=deploymentFailureDiagnostic('firebase-deploy',{
    code:1,stdout:JSON.stringify({status:'error',error:message}),stderr:''
  },{providerMutationMayHaveStarted:true});
  assert.equal(result.code,'PROVIDER_PERMISSION');
  assert.equal(result.detail,'FIREBASE_PERMISSION_DENIED');
  assert.equal(result.firebaseCliErrorCategory,'PERMISSION_DENIED');
  assert.equal(result.firebaseCliOutputShape,'json-error');
  assert.equal(result.firebaseCliProcessOutcome,'exit-code');
  assert.equal(result.stdoutPresent,true);
  assert.equal(result.stderrPresent,false);
  assert.equal(result.exitCode,1);
  const serialized=JSON.stringify(result);
  for(const secret of secrets)assert.equal(serialized.includes(secret),false);
  assert.equal(serialized.includes(message),false);
});

test('Firebase CLI JSON error classifier emits only allowlisted service and permission categories',()=>{
  const secrets=[
    'nested-password-DO-NOT-LOG',
    'member.private@example.test',
    'projects/private-project-8675309',
    'ya29.nested-fixture-token'
  ];
  const nestedPermission={
    status:'error',
    error:{
      message:JSON.stringify({
        status:'PERMISSION_DENIED',
        message:`Permission 'serviceusage.services.use' denied on ${secrets.join(' ')}`
      }),
      details:[{serviceName:'serviceusage.googleapis.com',reason:'PERMISSION_DENIED'}]
    }
  };
  const result=deploymentFailureDiagnostic('firebase-deploy',{
    code:1,stdout:JSON.stringify(nestedPermission),stderr:''
  });
  assert.equal(result.firebaseCliOutputShape,'json-error');
  assert.equal(result.firebaseCliErrorCategory,'SERVICE_USAGE_PERMISSION_DENIED');
  const serialized=JSON.stringify(result);
  for(const secret of secrets)assert.equal(serialized.includes(secret),false);
  assert.equal(serialized.includes('serviceusage.services.use'),false);
  assert.equal(serialized.includes('PERMISSION_DENIED on'),false);
});

test('Firebase CLI JSON error classifier returns unknown for malformed or unrecognized error text',()=>{
  const secret='do-not-log-password project=private-id person@example.test ya29.private-token';
  for(const stdout of [
    `warning\n{"status":"error","error":"PERMISSION_DENIED ${secret}"}`,
    JSON.stringify({status:'error',error:{message:`opaque ${secret}`,serviceName:'unknown.googleapis.com'}}),
    JSON.stringify({status:'error',error:`opaque ${secret}`})
  ]){
    const result=deploymentFailureDiagnostic('firebase-deploy',{code:1,stdout,stderr:''});
    assert.equal(result.firebaseCliErrorCategory,'UNKNOWN');
    const serialized=JSON.stringify(result);
    assert.equal(serialized.includes(secret),false);
    assert.equal(serialized.includes('private-id'),false);
    assert.equal(serialized.includes('example.test'),false);
    assert.equal(serialized.includes('ya29'),false);
  }
});

test('Firebase CLI JSON error classifier maps service-disabled errors to a fixed API category',()=>{
  const secret='credential-secret project-private-id';
  const result=deploymentFailureDiagnostic('firebase-deploy',{
    code:1,
    stdout:JSON.stringify({
      status:'error',
      error:{message:`SERVICE_DISABLED for eventarc.googleapis.com ${secret}`}
    }),
    stderr:''
  });
  assert.equal(result.firebaseCliErrorCategory,'EVENTARC_API_DISABLED');
  const serialized=JSON.stringify(result);
  assert.equal(serialized.includes(secret),false);
  assert.equal(serialized.includes('eventarc.googleapis.com'),false);
});

test('Firebase CLI JSON error classifier avoids guessing when an error names multiple services',()=>{
  const secret='account@example.test private-project-456 token-secret';
  for(const [message,expected] of [
    [`PERMISSION_DENIED from serviceusage.googleapis.com and cloudscheduler.googleapis.com ${secret}`,'PERMISSION_DENIED'],
    [`SERVICE_DISABLED for eventarc.googleapis.com and pubsub.googleapis.com ${secret}`,'API_DISABLED']
  ]){
    const result=deploymentFailureDiagnostic('firebase-deploy',{
      code:1,stdout:JSON.stringify({status:'error',error:{message}}),stderr:''
    });
    assert.equal(result.firebaseCliErrorCategory,expected);
    const serialized=JSON.stringify(result);
    assert.equal(serialized.includes(secret),false);
    assert.equal(serialized.includes('serviceusage.googleapis.com'),false);
    assert.equal(serialized.includes('cloudscheduler.googleapis.com'),false);
    assert.equal(serialized.includes('eventarc.googleapis.com'),false);
    assert.equal(serialized.includes('pubsub.googleapis.com'),false);
  }
});

test('Firebase CLI output shape is bounded and distinguishes empty, malformed, and other JSON',()=>{
  const cases=[
    [{code:1,stdout:'',stderr:'opaque error'},'empty'],
    [{code:1,stdout:'warning\n{"status":"error","error":"private"}',stderr:''},'malformed-or-mixed'],
    [{code:1,stdout:'{"status":"unknown","private":"do-not-log"}',stderr:''},'json-other'],
    [{code:1,stdout:'x'.repeat(64*1024+1),stderr:''},'too-large']
  ];
  for(const [error,shape] of cases){
    const result=deploymentFailureDiagnostic('firebase-deploy',error);
    assert.equal(result.firebaseCliOutputShape,shape);
    assert.equal(JSON.stringify(result).includes('do-not-log'),false);
    assert.equal(JSON.stringify(result).includes('"private"'),false);
  }
  assert.equal(deploymentFailureDiagnostic('firebase-deploy',{
    code:1,stdout:'{"status":"success","result":{}}',stderr:''
  }).firebaseCliOutputShape,'json-success');
});

test('Firebase CLI process failures expose only allowlisted outcome categories',()=>{
  const spawn=deploymentFailureDiagnostic('firebase-deploy',{code:'ENOENT',message:'secret path',stdout:'',stderr:''});
  assert.equal(spawn.code,'LOCAL_TOOL_OR_FILE_MISSING');
  assert.equal(spawn.firebaseCliProcessOutcome,'spawn-error');
  const signaled=deploymentFailureDiagnostic('firebase-deploy',{code:null,signal:'SIGTERM',message:'private text'});
  assert.equal(signaled.firebaseCliProcessOutcome,'signal');
  assert.equal(JSON.stringify(signaled).includes('SIGTERM'),false);
  assert.equal(JSON.stringify(signaled).includes('private text'),false);
  const outputLimit=deploymentFailureDiagnostic('firebase-deploy',{
    code:'ERR_CHILD_PROCESS_STDIO_MAXBUFFER',killed:true,stdout:'x'.repeat(20),stderr:''
  });
  assert.equal(outputLimit.code,'LOCAL_OUTPUT_LIMIT');
  assert.equal(outputLimit.detail,'FIREBASE_CLI_OUTPUT_CAPTURE_LIMIT');
  assert.equal(outputLimit.firebaseCliProcessOutcome,'output-limit');
});
