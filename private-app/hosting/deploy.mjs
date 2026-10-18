import {readFile,writeFile,mkdtemp,rm,appendFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join,resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {initializeApp,deleteApp} from 'firebase-admin/app';
import {getFirestore} from 'firebase-admin/firestore';
import {release} from './release-core.mjs';
import {smoke} from './smoke.mjs';
import {buildEnvironment,functionEnvironment} from './deployment-config.mjs';
import {changedPaths,requireHostedEvidence} from '../../scripts/release-scope.mjs';
const run=promisify(execFile),root=fileURLToPath(new URL('../',import.meta.url));
const [configPath,command='production']=process.argv.slice(2);
try{
  const config=JSON.parse(await readFile(configPath,'utf8'));
  const buildEnv=buildEnvironment(config),env={...process.env,...buildEnv};
  const sha=(await run('git',['rev-parse','HEAD'],{cwd:root})).stdout.trim();
  const target=config.mode==='production'?'justelle-private-production':'justelle-private-qualification';
  const configName=config.mode==='production'?'firebase.production.json':'firebase.json';
  const runtimeFile='hosting/functions/.env.'+config.projectId;
  async function deploy(directory){
    await writeFile(join(directory,runtimeFile),functionEnvironment(config),{mode:0o600});
    await writeFile(join(directory,'hosting/.firebaserc'),JSON.stringify({targets:{[config.projectId]:{hosting:{[target]:[config.site]}}}}),{mode:0o600});
    await run('npm',['ci','--no-audit','--no-fund'],{cwd:directory,env,maxBuffer:8*1024*1024});
    await run('npm',['ci','--prefix','hosting/functions','--no-audit','--no-fund'],{cwd:directory,env,maxBuffer:8*1024*1024});
    await run('npm',['run','build'],{cwd:directory,env,maxBuffer:8*1024*1024});
    await run(process.execPath,[join(directory,'node_modules/firebase-tools/lib/bin/firebase.js'),'deploy','--non-interactive',
      '--project',config.projectId,'--config',join(directory,'hosting',configName),
      '--only','hosting:'+target+',functions:gateway,firestore,storage'],{cwd:directory,env,maxBuffer:8*1024*1024});
  }
  if(command==='qualification'){
    if(config.mode!=='hosted-fictional')throw Error('Wrong qualification environment');
    await deploy(root);console.log('Fictional deployment completed; acceptance must now run');
  }else{
    if(config.mode!=='production'||process.env.JUSTELLE_INITIAL_ACCEPTANCE!=='verified')throw Error('Initial hosted/device/recovery acceptance is required');
    const app=initializeApp({projectId:config.projectId}),db=getFirestore(app);
    const state=db.doc('rooms/'+config.roomId+'/operations/release');
    try{
      const saved=await state.get(),previous=saved.exists?saved.data():null;
      // A failed sensitive release cannot be smuggled out by a later CSS-only commit.
      requireHostedEvidence(previous?changedPaths(previous.sha,sha):null,
        process.env.JUSTELLE_HOSTED_QUALIFIED==='true');
      await release({sha,qualified:true,readLastGood:async()=>previous,
        deploy:()=>deploy(root),check:version=>smoke({...config,sha:version}),
        recordGood:async good=>state.set({...good,verified_at:new Date().toISOString()}),
        rollback:async previous=>{
          const temp=await mkdtemp(join(tmpdir(),'justelle-rollback-')),checkout=join(temp,'source');
          try{
            await run('git',['worktree','add','--detach',checkout,previous],{cwd:resolve(root,'..')});
            await deploy(join(checkout,'private-app'));
          }finally{
            await run('git',['worktree','remove','--force',checkout],{cwd:resolve(root,'..')}).catch(()=>{});
            await rm(temp,{recursive:true,force:true});
          }
        },failClosed:async()=>{
          // An initial failed launch has no previous version to restore.
          await run('gcloud',['run','services','remove-iam-policy-binding','privateapi','--region','northamerica-northeast1',
            '--project',config.projectId,'--member','allUsers','--role','roles/run.invoker','--quiet'],{maxBuffer:1024*1024});
          await run(process.execPath,[join(root,'node_modules/firebase-tools/lib/bin/firebase.js'),'hosting:disable','--project',config.projectId,
            '--site',config.site,'--force'],{cwd:root,maxBuffer:1024*1024});
        },report:async result=>{
          const safe=JSON.stringify(result);console.log(safe);
          if(process.env.GITHUB_STEP_SUMMARY)await appendFile(process.env.GITHUB_STEP_SUMMARY,'Justelle release: '+safe+'\n');
        }});
    }finally{await db.terminate();await deleteApp(app);}
  }
}catch{
  // Provider/CLI errors can contain private identifiers. Keep public Actions logs clean.
  console.error('Justelle deployment or recovery failed. Review the safe release status and private provider console.');process.exitCode=1;
}
