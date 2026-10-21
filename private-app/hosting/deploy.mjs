import {readFile,writeFile,mkdtemp,rm,appendFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join,resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {initializeApp,deleteApp,applicationDefault} from 'firebase-admin/app';
import {getFirestore} from 'firebase-admin/firestore';
import {release,disableInitialService} from './release-core.mjs';
import {smoke} from './smoke.mjs';
import {buildEnvironment,functionEnvironment} from './deployment-config.mjs';
import {qualificationDrill,checkQualificationClosed} from './qualification-drill.mjs';
import {changedPaths,requireHostedEvidence} from '../../scripts/release-scope.mjs';
import {enforceAuthConfig} from './auth-config.mjs';
const run=promisify(execFile),root=fileURLToPath(new URL('../',import.meta.url));
const [configPath,command='production',previousSha]=process.argv.slice(2);
try{
  const config=JSON.parse(await readFile(configPath,'utf8'));
  const buildEnv=buildEnvironment(config),env={...process.env,...buildEnv};
  const sha=(await run('git',['rev-parse','HEAD'],{cwd:root})).stdout.trim();
  const target=config.mode==='production'?'justelle-private-production':'justelle-private-qualification';
  const configName=config.mode==='production'?'firebase.production.json':'firebase.json';
  const runtimeFile='hosting/functions/.env.'+config.projectId;
  const shell=process.env.ComSpec||'cmd.exe';
  const npm=async(args,directory)=>run(process.platform==='win32'?shell:'npm',
    // These arguments are fixed below, never configuration or caller input.
    process.platform==='win32'?['/d','/s','/c','npm.cmd '+args.join(' ')]:args,
    {cwd:directory,env,maxBuffer:8*1024*1024});
  async function deploy(directory){
    await enforceAuthConfig(config.projectId,{credential:applicationDefault()});
    await writeFile(join(directory,runtimeFile),functionEnvironment(config),{mode:0o600});
    await writeFile(join(directory,'hosting/.firebaserc'),JSON.stringify({targets:{[config.projectId]:{hosting:{[target]:[config.site]}}}}),{mode:0o600});
    await npm(['ci','--no-audit','--no-fund'],directory);
    await npm(['ci','--prefix','hosting/functions','--no-audit','--no-fund'],directory);
    await npm(['run','build'],directory);
    await run(process.execPath,[join(directory,'node_modules/firebase-tools/lib/bin/firebase.js'),'deploy','--non-interactive',
      '--project',config.projectId,'--config',join(directory,'hosting',configName),
      '--only','hosting:'+target+',functions:gateway,firestore,storage'],{cwd:directory,env,maxBuffer:8*1024*1024});
  }
  async function deploySource(version){
    const temp=await mkdtemp(join(tmpdir(),'justelle-rollback-')),checkout=join(temp,'source');
    try{
      await run('git',['worktree','add','--detach',checkout,version],{cwd:resolve(root,'..')});
      await deploy(join(checkout,'private-app'));
    }finally{
      await run('git',['worktree','remove','--force',checkout],{cwd:resolve(root,'..')}).catch(()=>{});
      await rm(temp,{recursive:true,force:true});
    }
  }
  const failClosed=()=>disableInitialService({
    // Both actions must run even if the first command fails.
    removePublicInvoker:()=>{
      const args=['run','services','remove-iam-policy-binding',
        'privateapi','--region','northamerica-northeast1','--project',config.projectId,
        '--member','allUsers','--role','roles/run.invoker','--quiet'];
      // projectId is already restricted to lowercase letters, digits and hyphens.
      return run(process.platform==='win32'?shell:'gcloud',
        process.platform==='win32'?['/d','/s','/c','gcloud.cmd '+args.join(' ')]:args,
        {maxBuffer:1024*1024});
    },
    disableHosting:()=>run(process.execPath,[
      join(root,'node_modules/firebase-tools/lib/bin/firebase.js'),'hosting:disable',
      '--project',config.projectId,'--site',config.site,'--force'],
      {cwd:root,maxBuffer:1024*1024,env})
  });
  async function report(result){
    const safe=JSON.stringify(result);console.log(safe);
    if(process.env.GITHUB_STEP_SUMMARY)await appendFile(process.env.GITHUB_STEP_SUMMARY,'Justelle release: '+safe+'\n');
  }
  if(command==='qualification'){
    if(config.mode!=='hosted-fictional')throw Error('Wrong qualification environment');
    await deploy(root);console.log('Fictional deployment completed; acceptance must now run');
  }else if(command==='qualification-drill'){
    // Resolve only an exact local ancestor, never an arbitrary branch or command.
    if(!/^[a-f0-9]{40}$/.test(previousSha||''))throw Error('An exact prior source SHA is required');
    const resolved=(await run('git',['rev-parse','--verify',previousSha+'^{commit}'],{cwd:root})).stdout.trim();
    if(resolved!==previousSha)throw Error('Prior source is not a commit');
    await run('git',['merge-base','--is-ancestor',previousSha,sha],{cwd:root});
    await qualificationDrill({config,sha,previousSha,deploy:deploySource,
      check:version=>smoke({...config,sha:version}),failClosed,
      checkClosed:()=>checkQualificationClosed(config.origin),report});
  }else{
    if(command!=='production'||config.mode!=='production'||process.env.JUSTELLE_INITIAL_ACCEPTANCE!=='verified')throw Error('Initial hosted/device/recovery acceptance is required');
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
        rollback:deploySource,failClosed,report});
    }finally{await db.terminate();await deleteApp(app);}
  }
}catch{
  // Provider/CLI errors can contain private identifiers. Keep public Actions logs clean.
  console.error('Justelle deployment or recovery failed. Review the safe release status and private provider console.');process.exitCode=1;
}
