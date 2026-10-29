import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,cp,rm,writeFile,mkdir} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {fileURLToPath} from 'node:url';
import {createRequire} from 'node:module';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {assertAuthorizedEndpointRoster,validateGeneratedFunctionsScope,validateLegacyRollbackFunctionsScope} from '../hosting/functions-scope.mjs';
const run=promisify(execFile),root=fileURLToPath(new URL('../',import.meta.url));
const require=createRequire(import.meta.url);
const cliPackagePath=require.resolve('firebase-tools/package.json');
const cliRequire=createRequire(cliPackagePath);
const filtersHelper=cliRequire('./lib/deploy/functions/functionsDeployHelper.js');
const hostingPrepare=cliRequire('./lib/deploy/hosting/prepare.js');
const backend=cliRequire('./lib/deploy/functions/backend.js');
const validate=cliRequire('./lib/deploy/functions/validate.js');
const checkValidTargetFilters=cliRequire('./lib/checkValidTargetFilters.js').checkValidTargetFilters;
test('Cloud upload package loads and routes real HTTP requests without any parent-directory source',async()=>{
  await run(process.execPath,[join(root,'tools/package-functions.mjs')],{cwd:root});
  const isolated=await mkdtemp(join(tmpdir(),'justelle-functions-package-'));
  try{
    const functionsDirectory=join(isolated,'functions');
    await mkdir(functionsDirectory);
    for(const name of ['lib','package.json','package-lock.json'])await cp(join(root,'hosting/functions',name),join(functionsDirectory,name),{recursive:true});
    const npmArgs=['ci','--offline','--omit=dev','--ignore-scripts','--no-audit','--no-fund'];
    await run(process.platform==='win32'?(process.env.ComSpec||'cmd.exe'):'npm',process.platform==='win32'?['/d','/s','/c','npm.cmd '+npmArgs.join(' ')]:npmArgs,{cwd:functionsDirectory});
    const configPath=join(isolated,'firebase.json');
    await writeFile(configPath,JSON.stringify({functions:[{source:'functions',codebase:'gateway',runtime:'nodejs22'}]}));
    const scope=await validateGeneratedFunctionsScope({configPath,projectId:'justelle-qualification'});
    assert.deepEqual(scope,{codebase:'gateway',endpointCount:2,endpointIds:['encryptedBackup','privateApi']});
    const legacyConfigPath=join(isolated,'legacy-firebase.json');
    await writeFile(legacyConfigPath,JSON.stringify({functions:[{source:'functions',codebase:'gateway',runtime:'nodejs20'}]}));
    assert.deepEqual(await validateLegacyRollbackFunctionsScope({configPath:legacyConfigPath,projectId:'justelle-qualification'}),
      {codebase:'gateway',source:'functions'});
    const only='hosting:justelle-private-qualification,functions,firestore,storage';
    const currentInvalidOnly='hosting:justelle-private-qualification,functions:gateway,functions,firestore,storage';
    await assert.rejects(checkValidTargetFilters({only:currentInvalidOnly}),/Cannot specify "--only functions"/);
    await checkValidTargetFilters({only});
    const functionsConfig=[{source:'functions',codebase:scope.codebase,runtime:'nodejs22'}];
    const filters=filtersHelper.getEndpointFilters({only},functionsConfig);
    assert.equal(filters,undefined,'the bare Functions selector is intentional after strict generated-roster validation');
    const endpoints=scope.endpointIds.map(id=>({id,codebase:scope.codebase,region:'northamerica-northeast1'}));
    const want={gateway:backend.of(...endpoints)};
    validate.checkFiltersIntegrity(want,filters);
    assert.deepEqual(filtersHelper.targetCodebases(functionsConfig,filters),['gateway']);
    assert.equal(endpoints.every(endpoint=>filtersHelper.endpointMatchesAnyFilter(endpoint,filters)),true);
    const originalExistingBackend=backend.existingBackend;
    backend.existingBackend=async()=>backend.empty();
    try{
      const options={only,normalizedHostingConfig:[{site:'fictional-site',target:'justelle-private-qualification',rewrites:[{
        source:'/api/**',function:{functionId:'privateApi',region:'northamerica-northeast1',pinTag:true}
      }]}]};
      await hostingPrepare.addPinnedFunctionsToOnlyString({},options);
      assert.equal(options.only,only,'bare functions must prevent an invalid mismatched default-codebase filter');
      await checkValidTargetFilters({only:options.only});
      validate.checkFiltersIntegrity(want,filtersHelper.getEndpointFilters({only:options.only},functionsConfig));
    }finally{backend.existingBackend=originalExistingBackend;}
    assert.throws(()=>assertAuthorizedEndpointRoster([{id:'privateApi'},{id:'otherEndpoint'}]),
      error=>error.scopeCode==='ENDPOINT_ROSTER_MISMATCH');
    assert.throws(()=>assertAuthorizedEndpointRoster([{id:'privateApi'}]),
      error=>error.scopeCode==='ENDPOINT_ROSTER_MISMATCH');
    assert.throws(()=>assertAuthorizedEndpointRoster([{id:'encryptedBackup'}]),
      error=>error.scopeCode==='ENDPOINT_ROSTER_MISMATCH');
    assert.throws(()=>assertAuthorizedEndpointRoster([{id:'privateApi'},{id:'encryptedBackup'},{id:'extraEndpoint'}]),
      error=>error.scopeCode==='ENDPOINT_ROSTER_MISMATCH');
    const extraCodebasePath=join(isolated,'extra-codebase.firebase.json');
    await writeFile(extraCodebasePath,JSON.stringify({functions:[
      {source:'functions',codebase:'gateway',runtime:'nodejs22'},
      {source:'other',codebase:'other',runtime:'nodejs22'}
    ]}));
    await assert.rejects(validateLegacyRollbackFunctionsScope({configPath:extraCodebasePath,projectId:'justelle-qualification'}),
      error=>error.scopeCode==='CODEBASE_COUNT_MISMATCH');
    await assert.rejects(validateGeneratedFunctionsScope({configPath:extraCodebasePath,projectId:'justelle-qualification'}),
      error=>error.scopeCode==='CODEBASE_COUNT_MISMATCH');
    const missingFunctionsPath=join(isolated,'missing-functions.firebase.json');
    await writeFile(missingFunctionsPath,JSON.stringify({functions:[{source:'functions',codebase:'other',runtime:'nodejs22'}]}));
    await assert.rejects(validateGeneratedFunctionsScope({configPath:missingFunctionsPath,projectId:'justelle-qualification'}),
      error=>error.scopeCode==='CODEBASE_CONFIG_MISMATCH');
    const script=`import assert from 'node:assert/strict';
      const {privateApi,encryptedBackup}=await import('./functions/lib/index.mjs');
      assert.equal(privateApi.__endpoint.platform,'gcfv2');
      assert.equal(encryptedBackup.__endpoint.platform,'gcfv2');
      const response=()=>({headersSent:false,writeHead(s,h){this.status=s;this.headers=h;},end(b){this.body=b;}});
      const health=response();await privateApi({url:'/api/healthz',originalUrl:'/api/healthz',method:'GET',headers:{}},health);
      assert.equal(health.status,200);assert.match(JSON.parse(health.body).version,/^[a-f0-9]{40}$/);
      const denied=response();await privateApi({url:'/api/respond',method:'POST',headers:{'content-type':'application/json'},rawBody:Buffer.from('{}')},denied);
      assert.equal(denied.status,401);
      const logged=[],originalError=console.error;
      process.env.JUSTELLE_ORIGIN='invalid-runtime-origin';
      try{
        console.error=message=>logged.push(message);
        await assert.rejects(encryptedBackup.run({}),/Encrypted backup failed; review private provider monitoring/);
      }finally{console.error=originalError;}
      assert.equal(logged.length,1);
      assert.equal(JSON.parse(logged[0]).event,'encrypted_backup_failed');
      assert.equal(logged[0].includes('invalid-runtime-origin'),false);
      console.log('Isolated deployment package passed');`;
    await writeFile(join(isolated,'verify.mjs'),script);
    const env={...process.env,JUSTELLE_MODE:'hosted-fictional',JUSTELLE_ROOM_ID:'fictional-room',JUSTELLE_ORIGIN:'https://fictional-qualification.web.app',
      FIREBASE_CONFIG:JSON.stringify({projectId:'fictional-qualification',storageBucket:'fictional-qualification.firebasestorage.app'})};
    delete env.GOOGLE_APPLICATION_CREDENTIALS;
    for(const k of Object.keys(env))if(k.endsWith('_EMULATOR_HOST')||k.includes('AI_KEY')||k.includes('BACKUP_CONFIG'))delete env[k];
    const result=await run(process.execPath,['verify.mjs'],{cwd:isolated,env});assert.match(result.stdout,/passed/);
  }finally{await rm(isolated,{recursive:true,force:true});}
});
