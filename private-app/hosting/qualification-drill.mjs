import {buildEnvironment} from './deployment-config.mjs';
import {release} from './release-core.mjs';

// Cloud callbacks are supplied by deploy.mjs; no production acceptance or
// persistent release-state document is consulted or changed by this drill.
export async function qualificationDrill({config,sha,previousSha,deploy,check,failClosed,checkClosed,report}){
  buildEnvironment(config);
  if(config.mode!=='hosted-fictional'||config.roomId!=='fictional-room'||
    config.origin!=='https://'+config.site+'.web.app'||
    !/^[a-f0-9]{40}$/.test(sha)||!/^[a-f0-9]{40}$/.test(previousSha)||sha===previousSha)
    throw Error('An isolated fictional project and two distinct source commits are required');
  // Establish which deployed source must be restored before making changes.
  await check(sha);
  let passed=false,restored=false;
  try{
    await deploy(previousSha);await check(previousSha);
    for(const previous of [{sha:previousSha},null]){
      let injected=false,status,recorded;
      try{
        await release({sha,qualified:true,readLastGood:async()=>previous,
          deploy,check:async version=>{
            await check(version);
            if(version===sha){injected=true;throw Error('Synthetic qualification smoke failure');}
          },recordGood:async value=>{recorded=value;},rollback:deploy,failClosed,
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
    try{await deploy(sha);await check(sha);restored=true;}
    finally{
      await report({status:passed&&restored?'qualification-drill-verified':
        restored?'qualification-drill-failed-restored':'qualification-drill-recovery-failed',sha,previousSha});
    }
  }
  return {verified:true,sha,previousSha};
}

export async function checkQualificationClosed(origin,fetchImpl=fetch){
  const url=new URL(origin);
  if(url.origin!==origin||url.protocol!=='https:'||!/^[a-z0-9-]+\.web\.app$/.test(url.hostname))
    throw Error('Only fictional Hosting can be checked for shutdown');
  for(const path of ['/','/api/healthz']){
    const response=await fetchImpl(origin+path,{redirect:'error',cache:'no-store',signal:AbortSignal.timeout(20000)});
    await response.body?.cancel();
    if(![403,404].includes(response.status))throw Error('Fictional Hosting shutdown was not verified');
  }
}
