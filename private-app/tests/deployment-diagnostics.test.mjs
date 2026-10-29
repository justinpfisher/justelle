import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {spawnSync} from 'node:child_process';
import {resolve} from 'node:path';
import {pathToFileURL} from 'node:url';
import {createDeploymentFailureRecorder,deploymentFailureDiagnostic,finalizeDeploymentFailure} from '../hosting/deployment-diagnostics.mjs';
import {buildFirebaseCliInvocation,createSafeFirebaseCliFunctionFilterDiagnostic,createSafeFirebaseRequestEvent,installFirebaseCliRequestDiagnostics,parseFirebaseCliFunctionFilterDiagnostics,parseFirebaseCliRequestDiagnostics,parseFirebaseCliTerminalErrorDiagnostic} from '../hosting/firebase-cli-request-diagnostics.mjs';
import {mkdtemp,mkdir,rm,symlink,writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';

const require=createRequire(import.meta.url);
const {Client}=require('../node_modules/firebase-tools/lib/apiv2.js');

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
    firebaseCliServiceCategory:'UNKNOWN',firebaseCliPermissionCategory:'UNKNOWN',
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
  assert.equal(result.firebaseCliServiceCategory,'UNKNOWN');
  assert.equal(result.firebaseCliPermissionCategory,'UNKNOWN');
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
  assert.equal(result.firebaseCliServiceCategory,'SERVICE_USAGE');
  assert.equal(result.firebaseCliPermissionCategory,'serviceusage.services.use');
  const serialized=JSON.stringify(result);
  for(const secret of secrets)assert.equal(serialized.includes(secret),false);
  assert.equal(serialized.includes('serviceusage.services.use'),true);
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
    assert.equal(result.firebaseCliServiceCategory,'UNKNOWN');
    assert.equal(result.firebaseCliPermissionCategory,'UNKNOWN');
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
  assert.equal(result.firebaseCliServiceCategory,'EVENTARC');
  assert.equal(result.firebaseCliPermissionCategory,'UNKNOWN');
  const serialized=JSON.stringify(result);
  assert.equal(serialized.includes(secret),false);
  assert.equal(serialized.includes('eventarc.googleapis.com'),false);
});

test('Firebase CLI JSON error classifier avoids guessing when an error names multiple services',()=>{
  const secret='account@example.test private-project-456 token-secret';
  for(const [message,expected] of [
    [`PERMISSION_DENIED from serviceusage.googleapis.com and cloudscheduler.googleapis.com ${secret}`,'PERMISSION_DENIED'],
    [`SERVICE_DISABLED for eventarc.googleapis.com and pubsub.googleapis.com ${secret}`,'API_DISABLED'],
    [`firebasestorage.googleapis.com and storage.googleapis.com both returned PERMISSION_DENIED ${secret}`,'PERMISSION_DENIED']
  ]){
    const result=deploymentFailureDiagnostic('firebase-deploy',{
      code:1,stdout:JSON.stringify({status:'error',error:{message}}),stderr:''
    });
    assert.equal(result.firebaseCliErrorCategory,expected);
    assert.equal(result.firebaseCliServiceCategory,'AMBIGUOUS');
    assert.equal(result.firebaseCliPermissionCategory,'UNKNOWN');
    const serialized=JSON.stringify(result);
    assert.equal(serialized.includes(secret),false);
    assert.equal(serialized.includes('serviceusage.googleapis.com'),false);
    assert.equal(serialized.includes('cloudscheduler.googleapis.com'),false);
    assert.equal(serialized.includes('eventarc.googleapis.com'),false);
    assert.equal(serialized.includes('pubsub.googleapis.com'),false);
  }
});


test('Firebase CLI identifies a Firebase Extensions denial without publishing raw error details',()=>{
  const privateFixture='fixture-password private.person@example.test projects/secret-project ya29.fake-token';
  const result=deploymentFailureDiagnostic('firebase-deploy',{
    code:1,stdout:JSON.stringify({
      status:'error',
      error:{
        code:403,
        status:'PERMISSION_DENIED',
        message:'permission firebaseextensions.instances.list denied for '+privateFixture,
        details:[{serviceName:'firebaseextensions.googleapis.com',methodName:'google.firebase.extensions.v1beta.Extensions.ListInstances'}]
      }
    }),stderr:''
  });
  assert.equal(result.firebaseCliErrorCategory,'FIREBASE_EXTENSIONS_PERMISSION_DENIED');
  assert.equal(result.firebaseCliServiceCategory,'FIREBASE_EXTENSIONS');
  assert.equal(result.firebaseCliPermissionCategory,'firebaseextensions.instances.list');
  const serialized=JSON.stringify(result);
  for(const secret of [privateFixture,'firebaseextensions.googleapis.com','google.firebase.extensions.v1beta.Extensions.ListInstances']){
    assert.equal(serialized.includes(secret),false);
  }
});

test('Firebase CLI identifies Firebase Storage metadata denial and its allowlisted permission',()=>{
  const privateFixture='fixture-password private.person@example.test projects/secret-project ya29.fake-token';
  const result=deploymentFailureDiagnostic('firebase-deploy',{
    code:1,stdout:JSON.stringify({
      status:'error',
      error:{
        code:403,
        status:'PERMISSION_DENIED',
        details:[{serviceName:'firebasestorage.googleapis.com',permission:'firebasestorage.defaultBucket.get'}],
        message:'PERMISSION_DENIED '+privateFixture
      }
    }),stderr:''
  });
  assert.equal(result.firebaseCliErrorCategory,'FIREBASE_STORAGE_PERMISSION_DENIED');
  assert.equal(result.firebaseCliServiceCategory,'FIREBASE_STORAGE');
  assert.equal(result.firebaseCliPermissionCategory,'firebasestorage.defaultbucket.get');
  const serialized=JSON.stringify(result);
  for(const secret of [privateFixture,'firebasestorage.googleapis.com','firebasestorage.defaultBucket.get']){
    assert.equal(serialized.includes(secret),false);
  }
});

test('Firebase CLI ties prose denials to complete permission tokens',()=>{
  const secret='private.person@example.test projects/private-project ya29.fixture-token';
  for(const message of [
    `serviceusage.services.use was granted; unknown.permission denied ${secret}`,
    `notserviceusage.services.use denied ${secret}`,
    `denied permission serviceusage.services.use.extra ${secret}`
  ]){
    const result=deploymentFailureDiagnostic('firebase-deploy',{
      code:1,stdout:JSON.stringify({
        status:'error',
        error:{status:'PERMISSION_DENIED',message}
      }),stderr:''
    });
    assert.equal(result.firebaseCliPermissionCategory,'UNKNOWN');
    const serialized=JSON.stringify(result);
    assert.equal(serialized.includes('serviceusage.services.use'),false);
    assert.equal(serialized.includes('private.person@example.test'),false);
    assert.equal(serialized.includes('private-project'),false);
    assert.equal(serialized.includes('ya29'),false);
    assert.equal(serialized.includes('unknown.permission'),false);
    assert.equal(serialized.includes('notserviceusage'),false);
  }
});

test('Firebase CLI fails closed on unknown and ambiguous nested permission fields',()=>{
  const privateFixture='private.person@example.test projects/secret-project ya29.fake-token';
  const ambiguous=deploymentFailureDiagnostic('firebase-deploy',{
    code:1,stdout:JSON.stringify({
      status:'error',error:{status:'PERMISSION_DENIED',details:[
        {serviceName:'firebasestorage.googleapis.com',permission:'firebasestorage.defaultBucket.get'},
        {serviceName:'firebaseextensions.googleapis.com',permission:'firebaseextensions.instances.list'}
      ],message:privateFixture}
    }),stderr:''
  });
  assert.equal(ambiguous.firebaseCliServiceCategory,'AMBIGUOUS');
  assert.equal(ambiguous.firebaseCliPermissionCategory,'AMBIGUOUS');
  const unknown=deploymentFailureDiagnostic('firebase-deploy',{
    code:1,stdout:JSON.stringify({
      status:'error',
      error:{status:'PERMISSION_DENIED',permission:'unlisted.privatePermission',message:'permission denied '+privateFixture}
    }),stderr:''
  });
  const mixed=deploymentFailureDiagnostic('firebase-deploy',{
    code:1,stdout:JSON.stringify({
      status:'error',error:{status:'PERMISSION_DENIED',details:[
        {permission:'firebasestorage.defaultBucket.get'},
        {permission:'unlisted.privatePermission'}
      ],message:privateFixture}
    }),stderr:''
  });
  assert.equal(unknown.firebaseCliServiceCategory,'UNKNOWN');
  assert.equal(unknown.firebaseCliPermissionCategory,'UNKNOWN');
  assert.equal(mixed.firebaseCliPermissionCategory,'AMBIGUOUS');
  for(const result of [ambiguous,unknown,mixed]){
    const serialized=JSON.stringify(result);
    assert.equal(serialized.includes(privateFixture),false);
    assert.equal(serialized.includes('privatePermission'),false);
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


test('Firebase CLI filter diagnostics distinguish empty discovery from codebase mismatch without names',()=>{
  const backendModule={allEndpoints:backend=>Object.values(backend.endpoints||{})};
  const endpointMatchesFilter=(endpoint,filter)=>
    (filter.codebase===undefined||endpoint.codebase===filter.codebase)&&
    (!filter.idChunks?.length||filter.idChunks.every(chunk=>endpoint.id.includes(chunk)));
  const endpoint={id:'secret-function-id',codebase:'gateway'};
  const base={backendModule,endpointMatchesFilter};
  assert.equal(createSafeFirebaseCliFunctionFilterDiagnostic({},[],base).outcome,'UNKNOWN');
  const empty=createSafeFirebaseCliFunctionFilterDiagnostic({gateway:{endpoints:{}}},[{codebase:'gateway',idChunks:['secret-function-id']}],base);
  assert.deepEqual(empty,{selectedCodebaseCategories:['GATEWAY'],filterCount:1,matchedFilterCount:0,discoveredEndpointCount:0,matchedEndpointCount:0,outcome:'NO_MATCH',truncated:false});
  const mismatch=createSafeFirebaseCliFunctionFilterDiagnostic({gateway:{endpoints:{[endpoint.id]:{...endpoint,codebase:'other'}}}},[{codebase:'gateway',idChunks:['secret-function-id']}],base);
  assert.deepEqual(mismatch,{selectedCodebaseCategories:['GATEWAY'],filterCount:1,matchedFilterCount:0,discoveredEndpointCount:1,matchedEndpointCount:0,outcome:'NO_MATCH',truncated:false});
  const match=createSafeFirebaseCliFunctionFilterDiagnostic({gateway:{endpoints:{[endpoint.id]:endpoint}}},[{codebase:'gateway',idChunks:['secret-function-id']}],base);
  assert.equal(match.outcome,'MATCH');
  assert.equal(JSON.stringify([empty,mismatch,match]).includes('secret-function-id'),false);
});

test('pinned CLI filter hook emits a strict bounded diagnostic adjacent to the real validator call',()=>{
  const nonce='d'.repeat(32),captured=[];
  const filterValidationModule={checkFiltersIntegrity(wantBackends,filters){assert.equal(filters.length,1);return 'validator-result';}};
  const backendModule={allEndpoints:backend=>Object.values(backend.endpoints||{})};
  const functionsDeployHelperModule={endpointMatchesFilter:(endpoint,filter)=>endpoint.codebase===filter.codebase};
  class SyntheticClient{async doRequest(){return 'ok';}}
  installFirebaseCliRequestDiagnostics({Client:SyntheticClient,errorOutModule:{errorOut:e=>e},nonce,writeDiagnostic:line=>captured.push(line),filterValidationModule,backendModule,functionsDeployHelperModule});
  const result=filterValidationModule.checkFiltersIntegrity({gateway:{endpoints:{a:{id:'private-id',codebase:'gateway'},b:{id:'private-id-2',codebase:'elsewhere'}}}},[{codebase:'gateway',idChunks:['private-filter-id']}]);
  assert.equal(result,'validator-result');
  const stderr=captured.join('');
  const parsed=parseFirebaseCliFunctionFilterDiagnostics(stderr,nonce);
  assert.deepEqual(parsed,{selectedCodebaseCategories:['GATEWAY'],filterCount:1,matchedFilterCount:1,discoveredEndpointCount:2,matchedEndpointCount:1,outcome:'MATCH',truncated:false});
  for(const forbidden of ['private-id','private-id-2','private-filter-id',nonce,'gateway'])assert.equal(JSON.stringify(parsed).includes(forbidden),false);
  for(const forbidden of ['private-id','private-id-2','private-filter-id','gateway'])assert.equal(stderr.includes(forbidden),false);
  const summary=deploymentFailureDiagnostic('firebase-deploy',{code:1,stdout:'{"status":"error","error":"opaque"}',stderr,}, {firebaseCliRequestNonce:nonce,providerMutationMayHaveStarted:true});
  assert.deepEqual(summary.firebaseCliFunctionFilterDiagnostic,parsed);
  assert.equal(parseFirebaseCliFunctionFilterDiagnostics('JUSTELLE_SAFE_FUNCTION_FILTER_DIAG:'+nonce+':{"selectedCodebaseCategories":["private"]}',nonce),null);
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

test('Pinned Firebase CLI request hook captures only allowlisted metadata from a synthetic 403 transport',async()=>{
  const nonce='a'.repeat(32);
  const secrets=['private-project-should-not-appear','private.person@example.test','ya29.synthetic-token','bucket-secret-name'];
  const captured=[];
  const originalFetch=globalThis.fetch;
  const fakeBody=JSON.stringify({error:{code:403,status:'PERMISSION_DENIED',message:secrets.join(' ')}});
  globalThis.fetch=async(url,options)=>{
    assert.equal(new URL(url).hostname,'firebasestorage.googleapis.com');
    assert.equal(options.method,'GET');
    return new Response(fakeBody,{status:403,headers:{'content-type':'application/json'}});
  };
  try{
    installFirebaseCliRequestDiagnostics({Client,errorOutModule:{errorOut:error=>error},nonce,writeDiagnostic:line=>captured.push(line)});
    const client=new Client({urlPrefix:'https://firebasestorage.googleapis.com',auth:false});
    await assert.rejects(client.get('/v1/projects/private-project-should-not-appear/defaultBucket'),
      error=>error.status===403);
  }finally{
    globalThis.fetch=originalFetch;
  }
  const parsed=parseFirebaseCliRequestDiagnostics(captured.join(''),nonce);
  assert.deepEqual(parsed,{
    events:[{
      serviceCategory:'FIREBASE_STORAGE',
      methodCategory:'GET',
      operationCategory:'GET_DEFAULT_BUCKET',
      httpStatus:403
    }],
    truncated:false
  });
  const serialized=JSON.stringify(parsed);
  for(const secret of secrets)assert.equal(serialized.includes(secret),false);
  assert.equal(serialized.includes('firebasestorage.googleapis.com'),false);
  assert.equal(serialized.includes(nonce),false);
});

test('Safe Firebase request categories never retain arbitrary URL or operation text',()=>{
  const event=createSafeFirebaseRequestEvent({
    urlPrefix:'https://cloudfunctions.googleapis.com',
    method:'POST',
    path:'/v2/projects/private-project/locations/private-region/functions/private-function:setIamPolicy?token=private',
    status:403
  });
  assert.deepEqual(event,{
    serviceCategory:'CLOUD_FUNCTIONS',
    methodCategory:'POST',
    operationCategory:'SET_IAM_POLICY',
    httpStatus:403
  });
  for(const [urlPrefix,serviceCategory] of [
    ['https://firebase.googleapis.com','FIREBASE_API'],
    ['https://firebaserules.googleapis.com','FIREBASE_RULES'],
    ['https://cloudresourcemanager.googleapis.com','CLOUD_RESOURCE_MANAGER'],
    ['https://secretmanager.googleapis.com','SECRET_MANAGER'],
    ['https://runtimeconfig.googleapis.com','RUNTIME_CONFIG']
  ]){
    const known=createSafeFirebaseRequestEvent({
      urlPrefix,method:'GET',path:'/v1/projects/private-project/resources?token=private',status:403
    });
    assert.equal(known.serviceCategory,serviceCategory);
    const serialized=JSON.stringify(known);
    assert.equal(serialized.includes(urlPrefix),false);
    assert.equal(serialized.includes('private-project'),false);
    assert.equal(serialized.includes('token'),false);
  }
  const unknown=createSafeFirebaseRequestEvent({
    urlPrefix:'https://private.example.test',
    method:'TRACE',
    path:'/private/person@example.test/secret-resource',
    status:403
  });
  assert.deepEqual(unknown,{
    serviceCategory:'UNKNOWN',
    methodCategory:'OTHER',
    operationCategory:'OTHER',
    httpStatus:403
  });
  assert.equal(createSafeFirebaseRequestEvent({
    urlPrefix:'https://firestore.googleapis.com',
    method:'GET',
    path:'/v1/private',
    status:200
  }),null);
});

test('Request metadata parser rejects forged, malformed, and out-of-schema records',()=>{
  const nonce='b'.repeat(32);
  const forged='JUSTELLE_SAFE_REQUEST_DIAG:'+'c'.repeat(32)+':'+
    JSON.stringify({serviceCategory:'FIRESTORE',methodCategory:'GET',operationCategory:'GET_RESOURCE',httpStatus:403});
  assert.deepEqual(parseFirebaseCliRequestDiagnostics(forged,nonce),{events:[],truncated:false});
  const prefix='JUSTELLE_SAFE_REQUEST_DIAG:'+nonce+':';
  for(const line of [
    prefix+'{not-json}',
    prefix+JSON.stringify({serviceCategory:'FIRESTORE',methodCategory:'GET',operationCategory:'GET_RESOURCE',httpStatus:403,project:'private-project'}),
    prefix+JSON.stringify({serviceCategory:'UNKNOWN',methodCategory:'TRACE',operationCategory:'secret',httpStatus:403})
  ]){
    assert.deepEqual(parseFirebaseCliRequestDiagnostics(line,nonce),{events:[],truncated:false});
  }
  assert.deepEqual(parseFirebaseCliRequestDiagnostics(Buffer.from(
    prefix+JSON.stringify({serviceCategory:'FIRESTORE',methodCategory:'GET',operationCategory:'READ_REQUEST',httpStatus:403})
  ),nonce),{
    events:[{serviceCategory:'FIRESTORE',methodCategory:'GET',operationCategory:'READ_REQUEST',httpStatus:403}],
    truncated:false
  });
});

test('Deployment failure output includes only nonce-validated request metadata',()=>{
  const nonce='d'.repeat(32);
  const privateError='projects/private-project/locations/private-region secret=never-publish@example.test';
  const safeRecord={
    serviceCategory:'CLOUD_SCHEDULER',
    methodCategory:'PATCH',
    operationCategory:'UPDATE_RESOURCE',
    httpStatus:403
  };
  const result=deploymentFailureDiagnostic('firebase-deploy',{
    code:1,
    stdout:JSON.stringify({status:'error',error:'HTTP Error: 403 '+privateError}),
    stderr:'JUSTELLE_SAFE_REQUEST_DIAG:'+nonce+':'+JSON.stringify(safeRecord)+'\n'
  },{
    providerMutationMayHaveStarted:true,
    firebaseCliRequestNonce:nonce
  });
  assert.deepEqual(result.firebaseCliRequestDiagnostics,[safeRecord]);
  assert.equal(JSON.stringify(result).includes(nonce),false);
  assert.equal(JSON.stringify(result).includes(privateError),false);
  assert.equal(JSON.stringify(result).includes('secret=never-publish'),false);
});

test('terminal CLI failure records only a uniquely correlated request from its cause chain',()=>{
  const nonce='f'.repeat(32),captured=[];
  class SyntheticClient { constructor(){this.opts={urlPrefix:'https://serviceusage.googleapis.com'};} async doRequest(){throw Object.assign(new Error('private body'),{status:403,context:{body:{permission:'serviceusage.services.use'}}});} }
  const errorOutModule={errorOut:error=>error};
  installFirebaseCliRequestDiagnostics({Client:SyntheticClient,errorOutModule,nonce,writeDiagnostic:line=>captured.push(line)});
  const client=new SyntheticClient();
  return client.doRequest({method:'GET',path:'/v1/projects/private-project/services',}).catch(requestError=>{
    const terminal=Object.assign(new Error('opaque provider text'),{original:requestError});
    errorOutModule.errorOut(terminal);
    const stderr=captured.join('');
    const parsed=parseFirebaseCliTerminalErrorDiagnostic(stderr,nonce);
    assert.equal(parsed.terminalRequestStatus,'MATCHED');
    assert.equal(parsed.serviceCategory,'SERVICE_USAGE');
    assert.equal(parsed.permissionCategory,'serviceusage.services.use');
    assert.equal(parsed.terminalError.nodes[0].messageTemplate,'OTHER');
    const summary=deploymentFailureDiagnostic('firebase-deploy',{
      code:1,stdout:'{"status":"error","error":"opaque"}',stderr
    },{firebaseCliRequestNonce:nonce});
    assert.deepEqual(summary.firebaseCliTerminalRequestDiagnostic,parsed);
    for(const secret of ['private body','private-project','opaque provider text','serviceusage.services.use']){
      if(secret==='serviceusage.services.use')continue;
      assert.equal(JSON.stringify(summary).includes(secret),false);
    }
  });
});

test('terminal CLI diagnostic does not attribute unrelated best-effort requests',()=>{
  const nonce='1'.repeat(32),captured=[];
  class SyntheticClient { async doRequest(){throw Object.assign(new Error('metadata denied'),{status:403});} }
  const errorOutModule={errorOut:error=>error};
  installFirebaseCliRequestDiagnostics({Client:SyntheticClient,errorOutModule,nonce,writeDiagnostic:line=>captured.push(line)});
  return new SyntheticClient().doRequest({method:'GET',path:'/v1/config'}).catch(()=>{
    errorOutModule.errorOut(new Error('unrelated terminal failure'));
    const parsed=parseFirebaseCliTerminalErrorDiagnostic(captured.join(''),nonce);
    assert.equal(parsed.terminalRequestStatus,'NO_REQUEST_CONTEXT');
    assert.equal(parsed.terminalError.nodes[0].kind,'ERROR');
  });
});

test('terminal diagnostic marks a cause chain truncated before uniqueness can be claimed',()=>{
  const nonce='3'.repeat(32),captured=[];
  class SyntheticClient { constructor(){this.opts={urlPrefix:'https://serviceusage.googleapis.com'};} async doRequest(){throw Object.assign(new Error('403'),{status:403});} }
  const errorOutModule={errorOut:error=>error};
  installFirebaseCliRequestDiagnostics({Client:SyntheticClient,errorOutModule,nonce,writeDiagnostic:line=>captured.push(line)});
  const client=new SyntheticClient();
  return Promise.all([
    client.doRequest({method:'GET',path:'/v1/visible'}).catch(error=>error),
    client.doRequest({method:'POST',path:'/v1/deep'}).catch(error=>error)
  ]).then(([visible,deep])=>{
    let nested=deep;
    for(let index=0;index<8;index++)nested={cause:nested};
    errorOutModule.errorOut({original:visible,cause:nested});
    const parsed=parseFirebaseCliTerminalErrorDiagnostic(captured.join(''),nonce);
    assert.equal(parsed.terminalRequestStatus,'AMBIGUOUS_REQUEST');
    assert.equal(parsed.terminalError.truncated,true);
  });
});

test('safe terminal permission extraction handles standard nested ErrorInfo metadata and fails closed on truncation',()=>{
  const nonce='4'.repeat(32),captured=[];
  class SyntheticClient { constructor(){this.opts={urlPrefix:'https://secretmanager.googleapis.com'};this.detailCount=1;this.oversizedPermission=false;} async doRequest(){
    const metadata={permission:'secretmanager.secrets.get'};
    const details=Array.from({length:this.detailCount},(_,index)=>index===0?{metadata}:{reason:'unrelated'});
    if(this.oversizedPermission)details.push({metadata:{permission:'x'.repeat(257)}});
    throw Object.assign(new Error('403'),{status:403,context:{body:{error:{details}}}});
  } }
  const errorOutModule={errorOut:error=>error};
  installFirebaseCliRequestDiagnostics({Client:SyntheticClient,errorOutModule,nonce,writeDiagnostic:line=>captured.push(line)});
  const client=new SyntheticClient();
  return client.doRequest({method:'GET',path:'/v1/projects/p/secrets/s'}).catch(error=>{
    errorOutModule.errorOut(error);
    const parsed=parseFirebaseCliTerminalErrorDiagnostic(captured.join(''),nonce);
    assert.equal(parsed.permissionCategory,'secretmanager.secrets.get');
    assert.equal(JSON.stringify(parsed).includes('secretmanager.googleapis.com'),false);
  }).then(()=>{
    captured.length=0;
    client.oversizedPermission=true;
    return client.doRequest({method:'GET',path:'/v1/projects/p/secrets/s'}).catch(error=>{
      errorOutModule.errorOut(error);
      const parsed=parseFirebaseCliTerminalErrorDiagnostic(captured.join(''),nonce);
      assert.equal(parsed.permissionCategory,'AMBIGUOUS');
      assert.equal(JSON.stringify(parsed).includes('x'.repeat(257)),false);
    });
  }).then(()=>{
    captured.length=0;
    client.oversizedPermission=false;
    client.detailCount=17;
    return client.doRequest({method:'GET',path:'/v1/projects/p/secrets/s'}).catch(error=>{
      errorOutModule.errorOut(error);
      const parsed=parseFirebaseCliTerminalErrorDiagnostic(captured.join(''),nonce);
      assert.equal(parsed.terminalRequestStatus,'MATCHED');
      assert.equal(parsed.permissionCategory,'AMBIGUOUS');
      assert.equal(JSON.stringify(parsed).includes('secretmanager.secrets.get'),false);
    });
  });
});

test('terminal diagnostic fails closed for multiple correlated requests and forged records',()=>{
  const nonce='2'.repeat(32),captured=[];
  class SyntheticClient { constructor(){this.opts={urlPrefix:'https://serviceusage.googleapis.com'};} async doRequest(){throw Object.assign(new Error('403'),{status:403});} }
  const errorOutModule={errorOut:error=>error};
  installFirebaseCliRequestDiagnostics({Client:SyntheticClient,errorOutModule,nonce,writeDiagnostic:line=>captured.push(line)});
  const client=new SyntheticClient();
  return Promise.all([
    client.doRequest({method:'GET',path:'/v1/a'}).catch(error=>error),
    client.doRequest({method:'POST',path:'/v1/b'}).catch(error=>error)
  ]).then(([first,second])=>{
    errorOutModule.errorOut({cause:first,original:second});
    assert.equal(parseFirebaseCliTerminalErrorDiagnostic(captured.join(''),nonce).terminalRequestStatus,'AMBIGUOUS_REQUEST');
    assert.equal(parseFirebaseCliTerminalErrorDiagnostic(
      'JUSTELLE_SAFE_TERMINAL_DIAG:'+nonce+':{"terminalRequestStatus":"MATCHED","url":"private"}',nonce),null);
  });
});

test('Node preload instruments the exact pinned Firebase CLI class before command execution',()=>{
  const nonce='e'.repeat(32);
  const script=[
    "const localRequire=require('node:module').createRequire(process.cwd()+'/tests/preload-fixture.cjs');",
    "const {Client}=localRequire('../node_modules/firebase-tools/lib/apiv2.js');",
    "globalThis.fetch=async()=>new Response(JSON.stringify({error:{code:403,status:'PERMISSION_DENIED',permission:'cloudfunctions.functions.setIamPolicy',message:'private-project fixture@example.test token-secret'}}),{status:403});",
    "const client=new Client({urlPrefix:'https://cloudfunctions.googleapis.com',auth:false});",
    "client.post('/v2/projects/private-project/locations/test/functions/test:setIamPolicy',{}).catch(error=>localRequire('../node_modules/firebase-tools/lib/errorOut.js').errorOut(error));"
  ].join('\n');
  const child=spawnSync(process.execPath,[
    '--import',pathToFileURL(resolve('hosting/firebase-cli-request-diagnostics.mjs')).href,'-e',script
  ],{
    cwd:process.cwd(),
    encoding:'utf8',
    maxBuffer:64*1024,
    env:{
      ...(process.env.SystemRoot?{SystemRoot:process.env.SystemRoot}:{}),
      ...(process.env.PATH?{PATH:process.env.PATH}:{}),
      JUSTELLE_FIREBASE_SAFE_DIAG_NONCE:nonce
    }
  });
  assert.equal(child.status,1,child.stderr);
  assert.equal(child.stdout,'');
  assert.equal(child.stderr.includes('private-project'),false);
  assert.equal(child.stderr.includes('example.test'),false);
  assert.equal(child.stderr.includes('token-secret'),false);
  const parsed=parseFirebaseCliRequestDiagnostics(child.stderr,nonce);
  assert.deepEqual(parsed,{
    events:[{
      serviceCategory:'CLOUD_FUNCTIONS',
      methodCategory:'POST',
      operationCategory:'SET_IAM_POLICY',
      httpStatus:403
    }],
    truncated:false
  });
  const terminal=parseFirebaseCliTerminalErrorDiagnostic(child.stderr,nonce);
  assert.equal(terminal.terminalRequestStatus,'MATCHED');
  assert.equal(terminal.serviceCategory,'CLOUD_FUNCTIONS');
  assert.equal(terminal.permissionCategory,'cloudfunctions.functions.setiampolicy');
  assert.equal(terminal.terminalError.nodes[0].name,'FIREBASE_ERROR');
  assert.deepEqual(terminal.terminalError.sourceFrames.truncated,false);
  assert.ok(terminal.terminalError.sourceFrames.frames.length>0);
  assert.ok(terminal.terminalError.sourceFrames.frames.every(frame=>/^lib\/[A-Za-z0-9._/-]+\.js$/.test(frame.file)));
  assert.ok(terminal.terminalError.sourceFrames.frames.some(frame=>frame.file==='lib/responseToError.js'));
  for(const secret of ['private-project','example.test','token-secret','C:\\Users\\','node_modules/firebase-tools']){
    assert.equal(JSON.stringify(terminal).includes(secret),false);
  }
});

test('terminal failure captures only bounded error-shape enums and message templates',()=>{
  const nonce='a'.repeat(32),captured=[];
  const errorOutModule={errorOut:error=>error};
  installFirebaseCliRequestDiagnostics({Client:class SyntheticClient{async doRequest(){}},errorOutModule,nonce,writeDiagnostic:line=>captured.push(line)});
  const privateText='project private-project, owner@example.test, https://secret.example/path?token=private-token, C:\\private\\config.json, password=hidden-value';
  const wrapped=Object.assign(new Error('An unexpected error has occurred.'),{
    name:'FirebaseError',
    original:Object.assign(new Error(`Permission denied for ${privateText}`),{
      code:'EACCES',status:403,token:'token-must-not-appear'
    })
  });
  errorOutModule.errorOut(wrapped);
  const parsed=parseFirebaseCliTerminalErrorDiagnostic(captured.join(''),nonce);
  assert.deepEqual(parsed,{
    terminalRequestStatus:'NO_REQUEST_CONTEXT',
    terminalError:{nodes:[
      {kind:'ERROR',name:'FIREBASE_ERROR',code:'NONE',messageTemplate:'CLI_UNEXPECTED_WRAPPER'},
      {kind:'ERROR',name:'ERROR',code:'EACCES',messageTemplate:'PERMISSION_DENIED',httpStatus:403}
    ],truncated:false}
  });
  for(const secret of ['private-project','owner@example.test','secret.example','private-token','config.json','hidden-value','token-must-not-appear','Permission denied for']){
    assert.equal(JSON.stringify(parsed).includes(secret),false);
  }
});

test('terminal diagnostic distinguishes plain strings and message-only objects without emitting their text',()=>{
  const nonce='d'.repeat(32),captured=[];
  const errorOutModule={errorOut:error=>error};
  installFirebaseCliRequestDiagnostics({Client:class SyntheticClient{async doRequest(){}},errorOutModule,nonce,writeDiagnostic:line=>captured.push(line)});
  errorOutModule.errorOut('private-project owner@example.test token=secret-value');
  let parsed=parseFirebaseCliTerminalErrorDiagnostic(captured.join(''),nonce);
  assert.equal(parsed.terminalError.nodes[0].kind,'STRING');
  assert.equal(parsed.terminalError.nodes[0].messageTemplate,'OTHER');
  assert.equal(JSON.stringify(parsed).includes('owner@example.test'),false);
  captured.length=0;
  errorOutModule.errorOut({message:'unclassified details from private customer',code:'private-code'});
  parsed=parseFirebaseCliTerminalErrorDiagnostic(captured.join(''),nonce);
  assert.equal(parsed.terminalError.nodes[0].kind,'MESSAGE_OBJECT');
  assert.equal(parsed.terminalError.nodes[0].code,'OTHER');
  assert.equal(JSON.stringify(parsed).includes('private customer'),false);
  assert.equal(JSON.stringify(parsed).includes('private-code'),false);
});

test('terminal message templates classify Firebase Functions discovery and module errors without dynamic text',()=>{
  const nonce='c'.repeat(32),captured=[];
  const errorOutModule={errorOut:error=>error};
  installFirebaseCliRequestDiagnostics({Client:class SyntheticClient{async doRequest(){}},errorOutModule,nonce,writeDiagnostic:line=>captured.push(line)});
  const messages=[
    ['Failed to load function definition from source: C:\\private\\function\\index.js project private-project token=secret-value','FUNCTIONS_DISCOVERY_FAILURE','NONE'],
    ['User code failed to load. Cannot determine backend specification. owner@example.test https://private.example/?key=secret-value','FUNCTIONS_DISCOVERY_FAILURE','NONE'],
    ['Discovery process failed: private-project secret=private-value','FUNCTIONS_DISCOVERY_FAILURE','NONE'],
    ['Cannot find package private-package from C:\\private\\function\\index.js','MODULE_RESOLUTION','MODULE_NOT_FOUND'],
    ['Module not found: private-module at /home/private/project','MODULE_RESOLUTION','MODULE_NOT_FOUND']
  ];
  for(const [message,messageTemplate,code] of messages){
    captured.length=0;
    const error=new Error(message);
    if(code!=='NONE')error.code=code;
    errorOutModule.errorOut(error);
    const parsed=parseFirebaseCliTerminalErrorDiagnostic(captured.join(''),nonce);
    assert.equal(parsed.terminalError.nodes[0].messageTemplate,messageTemplate);
    assert.equal(parsed.terminalError.nodes[0].code,code);
    for(const secret of ['private-project','private-package','private-module','owner@example.test','private.example','secret-value','private-value','C:\\private\\function\\index.js','/home/private/project']){
      assert.equal(JSON.stringify(parsed).includes(secret),false);
    }
  }
});

test('terminal parser retains compatibility with prior bounded request records',()=>{
  const nonce='e'.repeat(32),prefix='JUSTELLE_SAFE_TERMINAL_DIAG:'+nonce+':';
  const legacy={terminalRequestStatus:'MATCHED',serviceCategory:'CLOUD_FUNCTIONS',methodCategory:'POST',
    operationCategory:'SET_IAM_POLICY',httpStatus:403,permissionCategory:'cloudfunctions.functions.setiampolicy'};
  assert.deepEqual(parseFirebaseCliTerminalErrorDiagnostic(prefix+JSON.stringify(legacy),nonce),legacy);
  assert.deepEqual(parseFirebaseCliTerminalErrorDiagnostic(prefix+'{"terminalRequestStatus":"NO_REQUEST_CONTEXT"}',nonce),
    {terminalRequestStatus:'NO_REQUEST_CONTEXT'});
});


test('Rollback diagnostics fall back for legacy CLI checkouts while forward deployment stays strict',async()=>{
  const temp=await mkdtemp(join(tmpdir(),'justelle-cli-rollback-'));
  const nonce='b'.repeat(32);
  async function checkout(name,version,{hook=true}={}){
    const directory=join(temp,name);
    const cliDirectory=join(directory,'node_modules/firebase-tools/lib/bin');
    await mkdir(cliDirectory,{recursive:true});
    await mkdir(join(directory,'hosting'),{recursive:true});
    await writeFile(join(directory,'node_modules/firebase-tools/package.json'),JSON.stringify({version}));
    const cliPath=join(cliDirectory,'firebase.js');
    await writeFile(cliPath,'// synthetic CLI fixture');
    const hookPath=join(directory,'hosting/firebase-cli-request-diagnostics.mjs');
    if(hook)await writeFile(hookPath,'// synthetic hook fixture');
    return {directory,cliPath,hookPath};
  }
  try{
    const legacyWithoutHook=await checkout('legacy-no-hook','15.30.0',{hook:false});
    const missingHook=await buildFirebaseCliInvocation({directory:legacyWithoutHook.directory,allowLegacyRollback:true,nonce});
    assert.deepEqual(missingHook,{
      args:[legacyWithoutHook.cliPath],nonce:null,diagnosticsUnavailable:'LEGACY_ROLLBACK_COMPATIBILITY'
    });
    await assert.rejects(buildFirebaseCliInvocation({directory:legacyWithoutHook.directory,nonce}),
      /required for forward deployment/);

    const legacyWithHook=await checkout('legacy-cli-with-hook','15.30.0');
    const oldVersion=await buildFirebaseCliInvocation({directory:legacyWithHook.directory,allowLegacyRollback:true,nonce});
    assert.deepEqual(oldVersion,{
      args:[legacyWithHook.cliPath],nonce:null,diagnosticsUnavailable:'LEGACY_ROLLBACK_COMPATIBILITY'
    });
    await assert.rejects(buildFirebaseCliInvocation({directory:legacyWithHook.directory,nonce}),
      /required for forward deployment/);

    const current=await checkout('current','15.34.0');
    const currentInvocation=await buildFirebaseCliInvocation({directory:current.directory,nonce});
    assert.deepEqual(currentInvocation,{
      args:['--import',pathToFileURL(current.hookPath).href,current.cliPath],
      nonce,
      diagnosticsUnavailable:null
    });
    await rm(current.hookPath);
    await assert.rejects(buildFirebaseCliInvocation({directory:current.directory,nonce}),
      /required for forward deployment/);
  }finally{
    await rm(temp,{recursive:true,force:true});
  }
});

test('Legacy rollback diagnostic unavailability is an explicit fixed enum',()=>{
  const secret='legacy fixture account@example.test private-project token';
  const result=finalizeDeploymentFailure(
    deploymentFailureDiagnostic('firebase-deploy',{code:1,stderr:'opaque '+secret}),
    true,
    {firebaseCliRequestDiagnosticsUnavailable:'LEGACY_ROLLBACK_COMPATIBILITY'}
  );
  assert.equal(result.firebaseCliRequestDiagnosticsUnavailable,'LEGACY_ROLLBACK_COMPATIBILITY');
  assert.equal(JSON.stringify(result).includes(secret),false);
  assert.equal(JSON.stringify(result).includes('opaque'),false);
});

test('Functions predeploy package failures are separated and safely classified before provider deployment',()=>{
  const secret='FIXTURE_PASSWORD private.person@example.test /private/project/token';
  const cases=[
    ['Functions package still refers to files outside the deployment package '+secret,'FUNCTIONS_PACKAGE_BOUNDARY_FAILED'],
    ['Cannot find package esbuild '+secret,'FUNCTIONS_PACKAGE_DEPENDENCY_MISSING'],
    ['esbuild Transform failed with 1 error '+secret,'FUNCTIONS_PACKAGE_BUILD_FAILED'],
    ['fatal: not a git repository '+secret,'FUNCTIONS_PACKAGE_SOURCE_REVISION_FAILED'],
    ['unrecognized local packaging failure '+secret,'FUNCTIONS_PACKAGE_FAILURE_UNCLASSIFIED']
  ];
  for(const [stderr,detail] of cases){
    const result=deploymentFailureDiagnostic('functions-package',{code:1,stderr},{providerMutationMayHaveStarted:false});
    assert.equal(result.phase,'functions-package');
    assert.equal(result.code,'LOCAL_COMMAND_FAILED');
    assert.equal(result.detail,detail);
    assert.equal(result.providerStateNeedsReconciliation,false);
    assert.equal(result.exitCode,1);
    const serialized=JSON.stringify(result);
    assert.equal(serialized.includes(secret),false);
    assert.equal(serialized.includes(stderr),false);
  }
  const missingTool=deploymentFailureDiagnostic('functions-package',{code:'ENOENT',stderr:'private path '+secret});
  assert.equal(missingTool.code,'LOCAL_TOOL_OR_FILE_MISSING');
  assert.equal(missingTool.detail,'FUNCTIONS_PACKAGE_FAILURE_UNCLASSIFIED');
});

test('Terminal CLI diagnostics retain only bounded Firebase CLI package-relative source frames',async()=>{
  const temp=await mkdtemp(join(tmpdir(),'justelle-terminal-stack-'));
  const privateRoot=join(temp,'private.owner@example.test');
  const firebaseToolsPackageRoot=join(privateRoot,'node_modules','firebase-tools');
  const internalFiles=Array.from({length:10},(_,index)=>join(firebaseToolsPackageRoot,'lib',`source-${index}.js`));
  const outsideFile=join(privateRoot,'functions','index.js');
  const lookalikeFile=join(privateRoot,'node_modules','firebase-tools-evil','lib','leak.js');
  const symlinkDirectory=join(firebaseToolsPackageRoot,'lib','linked-outside');
  await Promise.all([
    ...internalFiles.map(file=>mkdir(join(file,'..'),{recursive:true})),
    mkdir(join(outsideFile,'..'),{recursive:true}),
    mkdir(join(lookalikeFile,'..'),{recursive:true})
  ]);
  await Promise.all([...internalFiles,outsideFile,lookalikeFile].map(file=>writeFile(file,'')));
  await symlink(join(privateRoot,'functions'),symlinkDirectory,'junction');
  const privateFixture='password=NeverPublish owner@example.test projects/private-project ya29.private-token';
  const error=new Error(privateFixture);
  error.stack=[
    `FirebaseError: ${privateFixture} ${privateRoot}`,
    `    at new FirebaseError (${pathToFileURL(internalFiles[0]).href}:29:11)`,
    `    at appFrame (${pathToFileURL(outsideFile).href}:4:2)`,
    `    at linkedFrame (${pathToFileURL(join(symlinkDirectory,'index.js')).href}:5:3)`,
    `    at attackerFrame (${pathToFileURL(lookalikeFile).href}:99:1)`,
    ...internalFiles.slice(1).map((file,index)=>`    at cliFrame${index} (${pathToFileURL(file).href}:${100+index}:7)`),
    '    at node:internal/process/task_queues:95:5'
  ].join('\n');
  const nonce='9'.repeat(32),captured=[];
  const errorOutModule={errorOut:value=>value};
  class SyntheticClient {async doRequest(){}}
  try{
    installFirebaseCliRequestDiagnostics({
      Client:SyntheticClient,errorOutModule,nonce,firebaseToolsPackageRoot,
      writeDiagnostic:line=>captured.push(line)
    });
    errorOutModule.errorOut(error);
    const parsed=parseFirebaseCliTerminalErrorDiagnostic(captured.join(''),nonce);
    assert.deepEqual(parsed.terminalError.sourceFrames,{
      frames:Array.from({length:8},(_,index)=>({file:`lib/source-${index}.js`,line:index===0?29:99+index})),
      truncated:true
    });
    const serialized=JSON.stringify(parsed);
    for(const secret of [privateFixture,'private.owner@example.test','private-project','ya29.private-token',
      'NeverPublish','owner@example.test','firebase-tools-evil','functions/index.js','node:internal','https://']){
      assert.equal(serialized.includes(secret),false,`diagnostic leaked ${secret}`);
    }
    assert.equal(serialized.includes('password='),false);
    assert.equal(serialized.includes('source-8.js'),false);
  }finally{
    await rm(temp,{recursive:true,force:true});
  }
});

test('Terminal diagnostic parser rejects dot-segment source frame paths',()=>{
  const nonce='8'.repeat(32);
  const prefix='JUSTELLE_SAFE_TERMINAL_DIAG:'+nonce+':';
  const base={terminalRequestStatus:'NO_REQUEST_CONTEXT',terminalError:{nodes:[],truncated:false,sourceFrames:{frames:[],truncated:false}}};
  for(const file of ['../private-secret.js','lib/../private-secret.js','lib/./internal.js','../../private-secret.js']){
    const record={...base,terminalError:{...base.terminalError,sourceFrames:{frames:[{file,line:17}],truncated:false}}};
    assert.equal(parseFirebaseCliTerminalErrorDiagnostic(prefix+JSON.stringify(record),nonce),null,file);
  }
});
