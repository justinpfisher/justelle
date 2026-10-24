import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,mkdir,readFile,writeFile,readdir,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join,basename} from 'node:path';
import {stageFirebaseDeploymentConfig} from '../hosting/firebase-deployment-config.mjs';

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
      const staged=await stageFirebaseDeploymentConfig({appDirectory,configName});
      try{
        assert.equal(basename(staged.path).startsWith('.justelle-deploy-'),true);
        const config=JSON.parse(await readFile(staged.path,'utf8'));
        assert.equal(config.hosting.target,configName==='firebase.json'?
          'justelle-private-qualification':'justelle-private-production');
        assert.equal(config.firestore.rules.startsWith('.justelle-deploy-'),true);
        assert.equal(config.firestore.indexes.startsWith('.justelle-deploy-'),true);
        assert.equal(await readFile(join(hostingDirectory,config.firestore.rules),'utf8'),rules);
        assert.equal(await readFile(join(hostingDirectory,config.firestore.indexes),'utf8'),indexes);
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

test('Firebase deployment staging accepts only the two controlled environment configs',async()=>{
  await assert.rejects(stageFirebaseDeploymentConfig({appDirectory:tmpdir(),configName:'untrusted.json'}),/Unsupported/);
});
