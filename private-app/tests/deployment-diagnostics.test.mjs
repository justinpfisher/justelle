import {test} from 'node:test';
import assert from 'node:assert/strict';
import {deploymentFailureDiagnostic} from '../hosting/deployment-diagnostics.mjs';

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
