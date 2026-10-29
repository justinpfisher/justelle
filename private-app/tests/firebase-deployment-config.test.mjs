import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,mkdir,readFile,writeFile,readdir,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join,basename} from 'node:path';
import {createRequire} from 'node:module';
import {stageFirebaseDeploymentConfig} from '../hosting/firebase-deployment-config.mjs';

const require=createRequire(import.meta.url);
const firebaseToolsPackage=require.resolve('firebase-tools/package.json');
const cliRequire=createRequire(firebaseToolsPackage);
const filtersHelper=cliRequire('./lib/deploy/functions/functionsDeployHelper.js');
const hostingPrepare=cliRequire('./lib/deploy/hosting/prepare.js');
const backend=cliRequire('./lib/deploy/functions/backend.js');
const validate=cliRequire('./lib/deploy/functions/validate.js');
const {filterTargets}=cliRequire('./lib/filterTargets.js');

test('Firebase deployment stages canonical Firestore rules and indexes within its project directory',async()=>{
  const appDirectory=await mkdtemp(join(tmpdir(),'justelle-firebase-config-'));
  const hostingDirectory=join(appDirectory,'hosting');
  await mkdir(hostingDirectory);
  await mkdir(join(appDirectory,'firebase'));
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
      const staged=await stageFirebaseDeploymentConfig({appDirectory,configName,projectId:configName==='firebase.json'?'justelle-qualification':'justelle-production'});
      try{
        assert.equal(basename(staged.path).startsWith('.justelle-deploy-'),true);
        const config=JSON.parse(await readFile(staged.path,'utf8'));
        assert.equal(config.hosting.target,configName==='firebase.json'?
          'justelle-private-qualification':'justelle-private-production');
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

test('Firebase deployment staging accepts only the two controlled environment configs',async()=>{
  await assert.rejects(stageFirebaseDeploymentConfig({appDirectory:tmpdir(),configName:'untrusted.json',projectId:'justelle-qualification'}),/Unsupported/);
});

test('pinned Hosting rewrite fallback does not add a mismatched default-codebase filter',async()=>{
  assert.equal(cliRequire('./package.json').version,'15.34.0');
  const functionsConfig=[{source:'functions',codebase:'gateway',runtime:'nodejs22'}];
  // These are the two fictional discovered endpoints exported by the gateway source.
  const endpoints=[
    {id:'privateApi',codebase:'gateway',region:'northamerica-northeast1'},
    {id:'encryptedBackup',codebase:'gateway',region:'northamerica-northeast1'}
  ];
  const want={gateway:backend.of(...endpoints)};
  const explicitSelector='hosting:justelle-private-qualification,functions:gateway,firestore,storage';
  const hostingConfig=[{site:'fictional-site',target:'justelle-private-qualification',rewrites:[{
    source:'/api/**',function:{functionId:'privateApi',region:'northamerica-northeast1',pinTag:true}
  }]}];
  const originalExistingBackend=backend.existingBackend;
  backend.existingBackend=async()=>backend.empty();
  try{
    // With no deployed backend yet, the actual pinned Hosting helper appends
    // functions:privateApi, which parses as a default-codebase filter.
    const failingOptions={only:explicitSelector,normalizedHostingConfig:hostingConfig};
    await hostingPrepare.addPinnedFunctionsToOnlyString({},failingOptions);
    assert.equal(failingOptions.only,explicitSelector+',functions:privateApi');
    const failingFilters=filtersHelper.getEndpointFilters({only:failingOptions.only},functionsConfig);
    assert.deepEqual(failingFilters,[
      {codebase:'gateway'},
      {codebase:'default',idChunks:['privateApi']}
    ]);
    assert.throws(()=>validate.checkFiltersIntegrity(want,failingFilters),/default:privateApi/);

    // A bare target tells that helper the Functions target is already included;
    // the explicit gateway filter still restricts deployment to this codebase.
    const safeOnly='hosting:justelle-private-qualification,functions:gateway,functions,firestore,storage';
    const safeOptions={only:safeOnly,normalizedHostingConfig:hostingConfig};
    await hostingPrepare.addPinnedFunctionsToOnlyString({},safeOptions);
    assert.equal(safeOptions.only,safeOnly);
    const safeFilters=filtersHelper.getEndpointFilters({only:safeOptions.only},functionsConfig);
    assert.deepEqual(safeFilters,[{codebase:'gateway'}]);
    assert.deepEqual(filtersHelper.targetCodebases(functionsConfig,safeFilters),['gateway']);
    assert.deepEqual(filtersHelper.targetCodebases([
      ...functionsConfig,{source:'other-functions',codebase:'other',runtime:'nodejs22'}
    ],safeFilters),['gateway']);
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
    const rollbackSelector='hosting:justelle-private-qualification,functions:gateway,functions,firestore,storage';
    assert.equal(legacyEnsureTargeted(rollbackSelector,'privateApi'),rollbackSelector);
    assert.deepEqual(filterTargets({config:{has:target=>['hosting','functions','firestore','storage'].includes(target)},only:safeOnly},
      ['hosting','functions','firestore','storage']),['hosting','functions','firestore','storage']);
    assert.deepEqual(endpoints.map(endpoint=>endpoint.id),['privateApi','encryptedBackup']);
  }finally{
    backend.existingBackend=originalExistingBackend;
  }
});
