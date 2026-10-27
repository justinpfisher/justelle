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
    providerStateNeedsReconciliation:true,exitCode:1
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
