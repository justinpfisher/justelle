import {readFile,writeFile,rm,cp} from 'node:fs/promises';
import {randomUUID} from 'node:crypto';
import {join} from 'node:path';

// Firebase CLI requires Firestore Rules and index files to live within the
// project directory. The canonical files live beside `hosting/`, so stage
// exact temporary copies beside the environment config for each deployment.
const qualificationProject='justelle-qualification';
const qualificationBucket='justelle-qualification.firebasestorage.app';

export async function stageFirebaseDeploymentConfig({appDirectory,configName,projectId}){
  if(!['firebase.json','firebase.production.json'].includes(configName))
    throw Error('Unsupported Firebase deployment config');
  const expectedProject=configName==='firebase.json'?'justelle-qualification':'justelle-production';
  if(projectId!==expectedProject)
    throw Error('Firebase deployment config does not match its project');

  const hostingDirectory=join(appDirectory,'hosting');
  const config=JSON.parse(await readFile(join(hostingDirectory,configName),'utf8'));
  if(!config.firestore||typeof config.firestore!=='object')
    throw Error('Firebase deployment config is missing Firestore settings');
  const prefix='.justelle-deploy-'+randomUUID();
  const created=[];
  async function stage(name,contents){
    const path=join(hostingDirectory,name);
    await writeFile(path,contents,{flag:'wx',mode:0o600});
    created.push(path);
    return name;
  }
  async function stageDirectory(name,sourceDirectory){
    const path=join(hostingDirectory,name);
    created.push(path);
    await cp(sourceDirectory,path,{recursive:true,errorOnExist:true,force:false});
    return name;
  }
  async function cleanup(){
    for(const path of created.reverse())await rm(path,{force:true,recursive:true});
  }
  try{
    const rules=await readFile(join(appDirectory,'firebase/firestore.rules'));
    const indexes=await readFile(join(appDirectory,'firebase/firestore.indexes.json'));
    const rulesName=await stage(prefix+'.firestore.rules',rules);
    const indexesName=await stage(prefix+'.firestore.indexes.json',indexes);
    const publicName=await stageDirectory('justelle-public-'+randomUUID(),join(appDirectory,'dist'));
    let storage=config.storage;
    if(projectId===qualificationProject){
      if(!storage||Array.isArray(storage)||typeof storage.rules!=='string'||!storage.rules)
        throw Error('Qualification Firebase config is missing its Storage rules path');
      storage=[{bucket:qualificationBucket,rules:storage.rules}];
    }
    const stagedConfig={...config,hosting:{...config.hosting,public:publicName},
      firestore:{...config.firestore,rules:rulesName,indexes:indexesName},storage};
    const configName=await stage(prefix+'.firebase.json',JSON.stringify(stagedConfig,null,2)+'\n');
    return {path:join(hostingDirectory,configName),cleanup};
  }catch(error){
    await cleanup();
    throw error;
  }
}
