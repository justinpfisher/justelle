import {readFile,writeFile,mkdtemp,rm,appendFile} from 'node:fs/promises';
import {randomBytes} from 'node:crypto';
import {tmpdir} from 'node:os';
import {join,resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {initializeApp,deleteApp} from 'firebase-admin/app';
import {getFirestore} from 'firebase-admin/firestore';
import {release,disableInitialService} from './release-core.mjs';
import {smoke} from './smoke.mjs';
import {buildEnvironment,functionEnvironment} from './deployment-config.mjs';
import {stageFirebaseDeploymentConfig} from './firebase-deployment-config.mjs';
import {validateGeneratedFunctionsScope,validateLegacyRollbackFunctionsScope} from './functions-scope.mjs';
import {qualificationDrill,checkQualificationClosed} from './qualification-drill.mjs';
import {changedPaths,requireHostedEvidence} from '../../scripts/release-scope.mjs';
import {createDeploymentFailureRecorder,deploymentFailureDiagnostic,finalizeDeploymentFailure} from './deployment-diagnostics.mjs';
import {buildFirebaseCliInvocation,parseFirebaseCliRequestDiagnostics} from './firebase-cli-request-diagnostics.mjs';
const run=promisify(execFile),root=fileURLToPath(new URL('../',import.meta.url));
const [configPath,command='production',previousSha]=process.argv.slice(2);
const failureRecorder=createDeploymentFailureRecorder();
let failurePhase='config-read',providerMutationMayHaveStarted=false,firebaseCliRequestNonce,firebaseCliRequestDiagnosticsUnavailable;
try{
  async function atPhase(phase,action){
    failurePhase=phase;
    try{return await action();}
    catch(error){failureRecorder.capture(phase,error,{providerMutationMayHaveStarted,firebaseCliRequestNonce,firebaseCliRequestDiagnosticsUnavailable});throw error;}
  }
  const configText=await readFile(configPath,'utf8');
  failurePhase='config-parse';
  const config=JSON.parse(configText);
  failurePhase='config-validation';
  const buildEnv=buildEnvironment(config),env={...process.env,...buildEnv};
  failurePhase='source-revision';
  const sha=(await run('git',['rev-parse','HEAD'],{cwd:root})).stdout.trim();
  const target=config.mode==='production'?'justelle-private-production':'justelle-private-qualification';
  const configName=config.mode==='production'?'firebase.production.json':'firebase.json';
  const runtimeFile='hosting/functions/.env.'+config.projectId;
  const shell=process.env.ComSpec||'cmd.exe';
  const npm=async(args,directory)=>run(process.platform==='win32'?shell:'npm',
    // These arguments are fixed below, never configuration or caller input.
    process.platform==='win32'?['/d','/s','/c','npm.cmd '+args.join(' ')]:args,
    {cwd:directory,env,maxBuffer:8*1024*1024});
  async function deploy(directory,{allowLegacyRollbackDiagnostics=false}={}){
    await atPhase('runtime-config-write',()=>writeFile(join(directory,runtimeFile),functionEnvironment(config),{mode:0o600}));
    await atPhase('target-config-write',()=>writeFile(join(directory,'hosting/.firebaserc'),JSON.stringify({targets:{[config.projectId]:{hosting:{[target]:[config.site]}}}}),{mode:0o600}));
    await atPhase('root-dependencies',()=>npm(['ci','--no-audit','--no-fund'],directory));
    await atPhase('functions-dependencies',()=>npm(['ci','--prefix','hosting/functions','--no-audit','--no-fund'],directory));
    await atPhase('app-build',()=>npm(['run','build'],directory));
    const stagedConfig=await atPhase('deployment-config-stage',()=>stageFirebaseDeploymentConfig({appDirectory:directory,configName,projectId:config.projectId}));
    try{
      // Run the same local bundle builder as Firebase's predeploy hook first,
      // so package failures are reported before any provider request.
      await atPhase('functions-package',()=>npm(['run','package:functions'],directory));
      await atPhase('functions-scope-validation',()=>allowLegacyRollbackDiagnostics?
        validateLegacyRollbackFunctionsScope({configPath:stagedConfig.path,projectId:config.projectId}):
        validateGeneratedFunctionsScope({configPath:stagedConfig.path,projectId:config.projectId}));
      await atPhase('firebase-deploy',async()=>{
        const invocation=await buildFirebaseCliInvocation({
          directory,
          allowLegacyRollback:allowLegacyRollbackDiagnostics,
          nonce:randomBytes(16).toString('hex')
        });
        firebaseCliRequestNonce=invocation.nonce;
        firebaseCliRequestDiagnosticsUnavailable=invocation.diagnosticsUnavailable;
        const cliEnv={...env};
        delete cliEnv.JUSTELLE_FIREBASE_SAFE_DIAG_NONCE;
        if(firebaseCliRequestNonce)cliEnv.JUSTELLE_FIREBASE_SAFE_DIAG_NONCE=firebaseCliRequestNonce;
        providerMutationMayHaveStarted=true;
        return run(process.execPath,[...invocation.args,'deploy','--non-interactive','--json',
          '--project',config.projectId,'--config',stagedConfig.path,
          '--only','hosting:'+target+',functions,firestore,storage'],{cwd:directory,env:cliEnv,maxBuffer:8*1024*1024});
      });
    }finally{
      await atPhase('deployment-config-cleanup',()=>stagedConfig.cleanup());
    }
  }
  async function deploySource(version){
    return atPhase('rollback-source-checkout',async()=>{
      const temp=await mkdtemp(join(tmpdir(),'justelle-rollback-')),checkout=join(temp,'source');
      try{
        await run('git',['worktree','add','--detach',checkout,version],{cwd:resolve(root,'..')});
        await deploy(join(checkout,'private-app'),{allowLegacyRollbackDiagnostics:true});
      }finally{
        await run('git',['worktree','remove','--force',checkout],{cwd:resolve(root,'..')}).catch(()=>{});
        await rm(temp,{recursive:true,force:true});
      }
    });
  }
  const failClosed=()=>disableInitialService({
    // Both actions must run even if the first command fails.
    removePublicInvoker:()=>atPhase('shutdown-run-access',()=>{
      providerMutationMayHaveStarted=true;
      const args=['run','services','remove-iam-policy-binding',
        'privateapi','--region','northamerica-northeast1','--project',config.projectId,
        '--member','allUsers','--role','roles/run.invoker','--quiet'];
      // projectId is already restricted to lowercase letters, digits and hyphens.
      return run(process.platform==='win32'?shell:'gcloud',
        process.platform==='win32'?['/d','/s','/c','gcloud.cmd '+args.join(' ')]:args,
        {maxBuffer:1024*1024});
    }),
    disableHosting:()=>atPhase('shutdown-hosting',()=>{providerMutationMayHaveStarted=true;return run(process.execPath,[
      join(root,'node_modules/firebase-tools/lib/bin/firebase.js'),'hosting:disable',
      '--project',config.projectId,'--site',config.site,'--force'],
      {cwd:root,maxBuffer:1024*1024,env});})
  });
  async function report(result){
    const safe=JSON.stringify(result);console.log(safe);
    if(process.env.GITHUB_STEP_SUMMARY)await appendFile(process.env.GITHUB_STEP_SUMMARY,'Justelle release: '+safe+'\n');
  }
  if(command==='qualification'){
    failurePhase='release-or-qualification-drill';
    if(config.mode!=='hosted-fictional')throw Error('Wrong qualification environment');
    await deploy(root);console.log('Fictional deployment completed; acceptance must now run');
  }else if(command==='qualification-drill'){
    failurePhase='release-or-qualification-drill';
    // Resolve only an exact local ancestor, never an arbitrary branch or command.
    if(!/^[a-f0-9]{40}$/.test(previousSha||''))throw Error('An exact prior source SHA is required');
    const resolved=(await atPhase('source-revision',()=>run('git',['rev-parse','--verify',previousSha+'^{commit}'],{cwd:root}))).stdout.trim();
    if(resolved!==previousSha)throw Error('Prior source is not a commit');
    await atPhase('source-revision',()=>run('git',['merge-base','--is-ancestor',previousSha,sha],{cwd:root}));
    await qualificationDrill({config,sha,previousSha,deploy:deploySource,
      check:version=>atPhase('hosted-smoke-check',()=>smoke({...config,sha:version})),failClosed,
      checkClosed:()=>atPhase('qualification-shutdown-check',()=>checkQualificationClosed(config.origin)),report});
  }else{
    failurePhase='release-precheck';
    if(command!=='production'||config.mode!=='production'||process.env.JUSTELLE_INITIAL_ACCEPTANCE!=='verified')throw Error('Initial hosted/device/recovery acceptance is required');
    const app=initializeApp({projectId:config.projectId}),db=getFirestore(app);
    const state=db.doc('rooms/'+config.roomId+'/operations/release');
    try{
      const saved=await atPhase('release-state-read',()=>state.get()),previous=saved.exists?saved.data():null;
      // A failed sensitive release cannot be smuggled out by a later CSS-only commit.
      requireHostedEvidence(previous?changedPaths(previous.sha,sha):null,
        process.env.JUSTELLE_HOSTED_QUALIFIED==='true');
      await release({sha,qualified:true,readLastGood:async()=>previous,
        deploy:()=>deploy(root),check:version=>atPhase('hosted-smoke-check',()=>smoke({...config,sha:version})),
        recordGood:async good=>atPhase('release-state-write',()=>state.set({...good,verified_at:new Date().toISOString()})),
        rollback:deploySource,failClosed,report});
    }finally{await db.terminate();await deleteApp(app);}
  }
}catch(error){
  // Never publish exception text, which may contain private identifiers or config values.
  const safe=finalizeDeploymentFailure(failureRecorder?.first,providerMutationMayHaveStarted,{firebaseCliRequestDiagnosticsUnavailable})
    ??deploymentFailureDiagnostic(failurePhase,error,{providerMutationMayHaveStarted,firebaseCliRequestNonce,firebaseCliRequestDiagnosticsUnavailable});
  console.error(JSON.stringify(safe));
  if(process.env.GITHUB_STEP_SUMMARY)await appendFile(process.env.GITHUB_STEP_SUMMARY,'Justelle deployment failed: `'+safe.phase+'` / `'+safe.code+'`'+(safe.providerStateNeedsReconciliation?' (provider state reconciliation required)':'')+'\n').catch(()=>{});
  process.exitCode=1;
}
