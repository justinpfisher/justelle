import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,mkdir,readFile,writeFile,readdir,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join,basename,resolve} from 'node:path';
import {createRequire} from 'node:module';
import {stageFirebaseDeploymentConfig} from '../hosting/firebase-deployment-config.mjs';
import {validateLegacyRollbackFunctionsScope} from '../hosting/functions-scope.mjs';

const require=createRequire(import.meta.url);
const firebaseToolsPackage=require.resolve('firebase-tools/package.json');
const cliRequire=createRequire(firebaseToolsPackage);
const filtersHelper=cliRequire('./lib/deploy/functions/functionsDeployHelper.js');
const hostingPrepare=cliRequire('./lib/deploy/hosting/prepare.js');
const backend=cliRequire('./lib/deploy/functions/backend.js');
const validate=cliRequire('./lib/deploy/functions/validate.js');
const checkValidTargetFilters=cliRequire('./lib/checkValidTargetFilters.js').checkValidTargetFilters;
const {filterTargets}=cliRequire('./lib/filterTargets.js');
const {Config}=cliRequire('./lib/config.js');

test('Firebase deployment stages canonical Firestore rules and indexes within its project directory',async()=>{
  const appDirectory=await mkdtemp(join(tmpdir(),'justelle-firebase-config-'));
  const hostingDirectory=join(appDirectory,'hosting');
  await mkdir(hostingDirectory);
  await mkdir(join(appDirectory,'firebase'));
  const distDirectory=join(appDirectory,'dist');
  await mkdir(distDirectory);
  await writeFile(join(distDirectory,'index.html'),'fictional build output');
  const rules='rules_version = \'2\';\nservice cloud.firestore { match /databases/{database}/documents { match /{document=**} { allow read, write: if false; } } }\n';
  const indexes=JSON.stringify({indexes:[],fieldOverrides:[]});
  await writeFile(join(appDirectory,'firebase/firestore.rules'),rules);
  await writeFile(join(appDirectory,'firebase/firestore.indexes.json'),indexes);
  const qualification={hosting:{target:'justelle-private-qualification',public:'../dist'},
    firestore:{rules:'../firebase/firestore.rules',indexes:'../firebase/firestore.indexes.json'},
    storage:{rules:'storage.rules'}};
  const production={...qualification,hosting:{...qualification.hosting,target:'justelle-private-production'}};
  await writeFile(join(hostingDirectory,'firebase.json'),JSON.stringify(qualification));
  await writeFile(join(hostingDirectory,'firebase.production.json'),JSON.stringify(production));
  try{
    for(const configName of ['firebase.json','firebase.production.json']){
      const original=await readFile(join(hostingDirectory,configName),'utf8');
      const sourceConfig=JSON.parse(original);
      const sourceCliConfig=Config.load({cwd:appDirectory,configPath:join(hostingDirectory,configName)});
      assert.throws(()=>sourceCliConfig.path(sourceConfig.hosting.public),/outside of project directory/);
      const staged=await stageFirebaseDeploymentConfig({appDirectory,configName,projectId:configName==='firebase.json'?'justelle-qualification':'justelle-production'});
      try{
        assert.equal(basename(staged.path).startsWith('.justelle-deploy-'),true);
        const config=JSON.parse(await readFile(staged.path,'utf8'));
        assert.equal(config.hosting.target,configName==='firebase.json'?
          'justelle-private-qualification':'justelle-private-production');
        assert.equal(config.hosting.public.startsWith('justelle-public-'),true);
        assert.equal(await readFile(join(hostingDirectory,config.hosting.public,'index.html'),'utf8'),
          'fictional build output');
        const stagedCliConfig=Config.load({cwd:appDirectory,configPath:staged.path});
        const stagedHosting=stagedCliConfig.get('hosting');
        const selectedHosting=Array.isArray(stagedHosting)?stagedHosting[0]:stagedHosting;
        assert.doesNotThrow(()=>stagedCliConfig.path(selectedHosting.public));
        assert.equal(resolve(stagedCliConfig.projectDir,selectedHosting.public),
          join(hostingDirectory,config.hosting.public));
        assert.equal(config.firestore.rules.startsWith('.justelle-deploy-'),true);
        assert.equal(config.firestore.indexes.startsWith('.justelle-deploy-'),true);
        assert.equal(await readFile(join(hostingDirectory,config.firestore.rules),'utf8'),rules);
        assert.equal(await readFile(join(hostingDirectory,config.firestore.indexes),'utf8'),indexes);
        if(configName==='firebase.json'){
          assert.deepEqual(config.storage,[{bucket:'justelle-qualification.firebasestorage.app',rules:'storage.rules'}]);
        }else{
          assert.deepEqual(config.storage,{rules:'storage.rules'});
        }
        assert.equal(await readFile(join(hostingDirectory,configName),'utf8'),original);
      }finally{
        await staged.cleanup();
      }
      assert.deepEqual((await readdir(hostingDirectory)).sort(),['firebase.json','firebase.production.json']);
    }
  }finally{
    await rm(appDirectory,{recursive:true,force:true});
  }
});

test('qualification rollback source staging also pins the verified explicit bucket',async()=>{
  const appDirectory=await mkdtemp(join(tmpdir(),'justelle-rollback-source-'));
  const hostingDirectory=join(appDirectory,'hosting');
  await mkdir(hostingDirectory);
  await mkdir(join(appDirectory,'firebase'));
  const distDirectory=join(appDirectory,'dist');
  await mkdir(distDirectory);
  await writeFile(join(distDirectory,'index.html'),'rollback build');
  await writeFile(join(appDirectory,'firebase/firestore.rules'),'rules');
  await writeFile(join(appDirectory,'firebase/firestore.indexes.json'),'{}');
  const original=JSON.stringify({hosting:{target:'justelle-private-qualification',public:'../dist'},
    firestore:{rules:'../firebase/firestore.rules',indexes:'../firebase/firestore.indexes.json'},
    storage:{rules:'storage.rules'}});
  await writeFile(join(hostingDirectory,'firebase.json'),original);
  try{
    const staged=await stageFirebaseDeploymentConfig({appDirectory,configName:'firebase.json',projectId:'justelle-qualification'});
    try{
      const config=JSON.parse(await readFile(staged.path,'utf8'));
      const stagedCliConfig=Config.load({cwd:appDirectory,configPath:staged.path});
      const stagedHosting=stagedCliConfig.get('hosting');
      const selectedHosting=Array.isArray(stagedHosting)?stagedHosting[0]:stagedHosting;
      assert.doesNotThrow(()=>stagedCliConfig.path(selectedHosting.public));
      assert.equal(await readFile(join(hostingDirectory,selectedHosting.public,'index.html'),'utf8'),'rollback build');
      assert.deepEqual(config.storage,[{bucket:'justelle-qualification.firebasestorage.app',rules:'storage.rules'}]);
      assert.equal(await readFile(join(hostingDirectory,'firebase.json'),'utf8'),original);
    }finally{await staged.cleanup();}
  }finally{await rm(appDirectory,{recursive:true,force:true});}
});

test('staging rejects a config paired with the wrong Firebase project',async()=>{
  await assert.rejects(
    stageFirebaseDeploymentConfig({appDirectory:tmpdir(),configName:'firebase.json',projectId:'justelle-production'}),
    /does not match its project/
  );
});

test('legacy rollback scope rejects extra codebases before the bare Functions target is used',async()=>{
  const appDirectory=await mkdtemp(join(tmpdir(),'justelle-rollback-scope-'));
  const sourceDirectory=join(appDirectory,'functions');
  await mkdir(sourceDirectory);
  try{
    const configPath=join(appDirectory,'firebase.json');
    await writeFile(configPath,JSON.stringify({functions:[{source:'functions',codebase:'gateway',runtime:'nodejs20'}]}));
    assert.deepEqual(await validateLegacyRollbackFunctionsScope({configPath,projectId:'justelle-qualification'}),
      {codebase:'gateway',source:'functions'});
    await writeFile(configPath,JSON.stringify({functions:[
      {source:'functions',codebase:'gateway',runtime:'nodejs20'},
      {source:'other',codebase:'other',runtime:'nodejs20'}
    ]}));
    await assert.rejects(validateLegacyRollbackFunctionsScope({configPath,projectId:'justelle-qualification'}),
      error=>error.scopeCode==='CODEBASE_COUNT_MISMATCH');
  }finally{
    await rm(appDirectory,{recursive:true,force:true});
  }
});

test('Firebase deployment staging accepts only the two controlled environment configs',async()=>{
  await assert.rejects(stageFirebaseDeploymentConfig({appDirectory:tmpdir(),configName:'untrusted.json',projectId:'justelle-qualification'}),/Unsupported/);
});

test('pinned Hosting rewrite fallback keeps the strictly validated gateway target compatible with CLI filters',async()=>{
  assert.equal(cliRequire('./package.json').version,'15.34.0');
  const functionsConfig=[{source:'functions',codebase:'gateway',runtime:'nodejs22'}];
  // These are the two fictional discovered endpoints exported by the gateway source.
  const endpoints=[
    {id:'privateApi',codebase:'gateway',region:'northamerica-northeast1'},
    {id:'encryptedBackup',codebase:'gateway',region:'northamerica-northeast1'}
  ];
  const want={gateway:backend.of(...endpoints)};
  const invalidSelector='hosting:justelle-private-qualification,functions:gateway,functions,firestore,storage';
  const safeOnly='hosting:justelle-private-qualification,functions,firestore,storage';
  const hostingConfig=[{site:'fictional-site',target:'justelle-private-qualification',rewrites:[{
    source:'/api/**',function:{functionId:'privateApi',region:'northamerica-northeast1',pinTag:true}
  }]}];
  const originalExistingBackend=backend.existingBackend;
  backend.existingBackend=async()=>backend.empty();
  try{
    // The previous mixed selector is rejected by the CLI top-level validator.
    await assert.rejects(checkValidTargetFilters({only:invalidSelector}),/Cannot specify "--only functions"/);
    // The bare selector is safe only because deploy.mjs first validates the generated
    // config and actual discovery against the exact gateway endpoint roster.
    await checkValidTargetFilters({only:safeOnly});
    const safeOptions={only:safeOnly,normalizedHostingConfig:hostingConfig};
    await hostingPrepare.addPinnedFunctionsToOnlyString({},safeOptions);
    assert.equal(safeOptions.only,safeOnly);
    const safeFilters=filtersHelper.getEndpointFilters({only:safeOptions.only},functionsConfig);
    assert.equal(safeFilters,undefined,'bare Functions intentionally selects the already scope-validated config');
    assert.deepEqual(filtersHelper.targetCodebases(functionsConfig,safeFilters),['gateway']);
    assert.equal(endpoints.every(endpoint=>filtersHelper.endpointMatchesAnyFilter(endpoint,safeFilters)),true);
    validate.checkFiltersIntegrity(want,safeFilters);
    // Rollback checkouts can use firebase-tools 14.27.0. Its ensureTargeted
    // implementation also preserves any selector containing bare "functions".
    const legacyEnsureTargeted=(only,codebaseOrFunction,functionId)=>{
      const parts=only.split(',');
      if(parts.includes('functions'))return only;
      let target='functions:'+codebaseOrFunction;
      if(parts.includes(target))return only;
      if(functionId){target+=':'+functionId;if(parts.includes(target))return only;}
      return only+','+target;
    };
    const rollbackSelector=safeOnly;
    assert.equal(legacyEnsureTargeted(rollbackSelector,'privateApi'),rollbackSelector);
    assert.deepEqual(filterTargets({config:{has:target=>['hosting','functions','firestore','storage'].includes(target)},only:safeOnly},
      ['hosting','functions','firestore','storage']),['hosting','functions','firestore','storage']);
    assert.deepEqual(endpoints.map(endpoint=>endpoint.id),['privateApi','encryptedBackup']);
  }finally{
    backend.existingBackend=originalExistingBackend;
  }
});
