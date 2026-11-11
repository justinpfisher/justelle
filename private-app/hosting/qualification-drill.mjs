import {buildEnvironment} from './deployment-config.mjs';
import {release} from './release-core.mjs';
import {setTimeout as delay} from 'node:timers/promises';

// Cloud callbacks are supplied by deploy.mjs; no production acceptance or
// persistent release-state document is consulted or changed by this drill.
export async function qualificationDrill({config,sha,previousSha,deploy,check,failClosed,checkClosed,
  readPublicInvoker,restorePublicInvoker,checkRestored,report}){
  buildEnvironment(config);
  if(config.mode!=='hosted-fictional'||config.roomId!=='fictional-room'||
    config.origin!=='https://'+config.site+'.web.app'||
    !/^[a-f0-9]{40}$/.test(sha)||!/^[a-f0-9]{40}$/.test(previousSha)||sha===previousSha)
    throw Error('An isolated fictional project and two distinct source commits are required');
  // Establish which deployed source must be restored before making changes.
  await check(sha);
  // Capture the exact access this drill may remove, before any mutation. An
  // immediate HTTP success alone can reflect an older, propagating IAM policy.
  if(!await readPublicInvoker())throw Error('Starting public invocation policy was not verified');
  let passed=false,restored=false,shutdownAttempted=false;
  try{
    await deploy(previousSha);await check(previousSha);
    for(const previous of [{sha:previousSha},null]){
      let injected=false,status,recorded;
      try{
        await release({sha,qualified:true,readLastGood:async()=>previous,
          deploy,check:async version=>{
            await check(version);
            if(version===sha){injected=true;throw Error('Synthetic qualification smoke failure');}
          },recordGood:async value=>{recorded=value;},rollback:deploy,
          failClosed:async()=>{shutdownAttempted=true;await failClosed();},
          report:async result=>{status=result.status;}});
      }catch{
        // Only the deliberate failure followed by verified recovery is expected.
        if(!injected||status!==(previous?'rolled-back':'disabled')||
          (previous?recorded?.sha!==previousSha:recorded!==undefined))
          throw Error('Fictional recovery drill did not verify the expected recovery');
      }
      if(!injected)throw Error('Fictional failure was not exercised');
      if(!previous)await checkClosed();
    }
    passed=true;
  }finally{
    // Restore the original source even if staging, rollback or shutdown failed.
    try{
      await deploy(sha);
      // Firebase may skip the unchanged function after shutdown; redeployment
      // is not proof that its removed Run invocation binding was restored.
      if(shutdownAttempted)await restorePublicInvoker();
      await checkRestored(sha);restored=true;
    }
    finally{
      await report({status:passed&&restored?'qualification-drill-verified':
        restored?'qualification-drill-failed-restored':'qualification-drill-recovery-failed',sha,previousSha});
    }
  }
  return {verified:true,sha,previousSha};
}

// IAM and Hosting changes propagate asynchronously. Require two complete,
// consecutive observations; errors and mixed states never count as success.
// The deadline bounds retries, plus any already-running bounded HTTP check.
export async function waitForQualificationState(check,{timeoutMs=300000,intervalMs=5000,
  now=Date.now,wait=delay}={}){
  if(!Number.isFinite(timeoutMs)||timeoutMs<=0||!Number.isFinite(intervalMs)||intervalMs<=0)
    throw Error('Invalid qualification convergence timeout');
  const deadline=now()+timeoutMs;
  let consecutive=0;
  while(now()<deadline){
    try{await check();consecutive++;}catch{consecutive=0;}
    if(now()>=deadline)break;
    if(consecutive===2)return;
    await wait(Math.min(intervalMs,deadline-now()));
  }
  throw Error('Qualification provider state did not converge');
}

export function hasPublicInvoker(policy){
  if(!policy||typeof policy!=='object'||
    (policy.bindings!==undefined&&!Array.isArray(policy.bindings)))
    throw Error('Invalid Run invocation policy');
  return (policy.bindings||[]).some(binding=>binding.role==='roles/run.invoker'&&
    binding.condition===undefined&&Array.isArray(binding.members)&&binding.members.includes('allUsers'));
}

export async function checkQualificationRestored({readPublicInvoker,check},pollOptions){
  await waitForQualificationState(async()=>{
    if(!await readPublicInvoker())throw Error('Public invocation was not restored');
    await check();
  },pollOptions);
}

export async function checkQualificationClosed(origin,fetchImpl=fetch,pollOptions){
  const url=new URL(origin);
  if(url.origin!==origin||url.protocol!=='https:'||!/^[a-z0-9-]+\.web\.app$/.test(url.hostname))
    throw Error('Only fictional Hosting can be checked for shutdown');
  await waitForQualificationState(async()=>{
    for(const path of ['/','/api/healthz']){
      const response=await fetchImpl(origin+path,{redirect:'error',cache:'no-store',signal:AbortSignal.timeout(20000)});
      await response.body?.cancel();
      if(![403,404].includes(response.status))throw Error('Fictional Hosting shutdown was not verified');
    }
  },pollOptions);
}
