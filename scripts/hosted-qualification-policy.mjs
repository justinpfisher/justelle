// Executable model of the release gate semantics tested against the workflow.
const equalsExpressionString=(actual,expected)=>typeof actual==='string'&&
  actual.toLowerCase()===expected.toLowerCase();
const qualificationFallback='fdc7a30639e36e1b4b2042d33849c100fe5c6452';

export function hostedQualificationPolicy({
  event='push',branch='main',hold='',hostedConfigured='',initialAcceptance='',hostedChanges=false,
  privatePilot='success',windowsPreview='skipped',qualificationResult='skipped',qualifyOnce=false,
  storageProbeOnce=false,hostingPreflightOnce=false,rollbackDrillOnce=false,
  qualificationDeployOnlyOnce=false,rollbackPreviousSha='',cancelled=false
}={}){
  const isPullRequest=event==='pull_request';
  const prerequisites=privatePilot==='success'&&['success','skipped'].includes(windowsPreview);
  const held=!isPullRequest&&equalsExpressionString(hold,'true');
  const deployOnly=qualificationDeployOnlyOnce===true;
  const manualQualification=event==='workflow_dispatch'&&equalsExpressionString(branch,'main')&&qualifyOnce===true&&
    storageProbeOnce!==true&&hostingPreflightOnce!==true&&rollbackDrillOnce!==true;
  const configured=equalsExpressionString(hostedConfigured,'true');
  const acceptanceGate=!equalsExpressionString(initialAcceptance,'verified')||hostedChanges;
  const qualificationEligible=prerequisites&&configured&&acceptanceGate;
  const manualHostingPreflight=!deployOnly&&event==='workflow_dispatch'&&equalsExpressionString(branch,'main')&&
    rollbackDrillOnce!==true&&hostingPreflightOnce===true&&qualifyOnce!==true&&storageProbeOnce!==true&&held&&configured&&prerequisites;
  const qualificationRequired=!deployOnly&&!isPullRequest&&storageProbeOnce!==true&&hostingPreflightOnce!==true&&rollbackDrillOnce!==true&&
    qualificationEligible&&(!held||manualQualification);
  const productionAllowed=!deployOnly&&!isPullRequest&&storageProbeOnce!==true&&hostingPreflightOnce!==true&&rollbackDrillOnce!==true&&!held&&equalsExpressionString(branch,'main')&&
    equalsExpressionString(initialAcceptance,'verified')&&prerequisites&&
    (equalsExpressionString(qualificationResult,'success')||
      (!hostedChanges&&equalsExpressionString(qualificationResult,'skipped')));
  const result={
    qualification:qualificationRequired?'run':'skipped',
    holdReport:held&&!deployOnly&&!rollbackDrillOnce&&!(manualQualification&&qualificationEligible)&&!manualHostingPreflight?'held':'not-applicable',
    production:productionAllowed?'run':'skipped'
  };
  if(rollbackDrillOnce)result.rollbackDrill=qualificationRollbackDrillPolicy({
    event,branch,rollbackDrillOnce,qualifyOnce,storageProbeOnce,hostingPreflightOnce,qualificationDeployOnlyOnce,
    hold,hostedConfigured,privatePilot,windowsPreview
  });
  if(hostingPreflightOnce)result.hostingPreflight=manualHostingPreflight?'run':'skipped';
  if(deployOnly)result.qualificationDeployOnly=qualificationDeployOnlyPolicy({event,branch,qualificationDeployOnlyOnce,
    qualifyOnce,storageProbeOnce,hostingPreflightOnce,rollbackDrillOnce,rollbackPreviousSha,cancelled,
    hold,hostedConfigured});
  return result;
}

export function firebaseStorageProbePolicy({
  event='push',branch='main',storageProbeOnce=false,qualifyOnce=false,hold='',hostedConfigured='',
  privatePilot='success',windowsPreview='skipped',hostingPreflightOnce=false,rollbackDrillOnce=false,qualificationDeployOnlyOnce=false
}={}){
  const prerequisites=privatePilot==='success'&&['success','skipped'].includes(windowsPreview);
  return event==='workflow_dispatch'&&equalsExpressionString(branch,'main')&&
    storageProbeOnce===true&&qualifyOnce!==true&&hostingPreflightOnce!==true&&rollbackDrillOnce!==true&&
    qualificationDeployOnlyOnce!==true&&equalsExpressionString(hold,'true')&&
    equalsExpressionString(hostedConfigured,'true')&&prerequisites?'run':'skipped';
}


export function qualificationRollbackDrillPolicy({
  event='push',branch='main',rollbackDrillOnce=false,qualifyOnce=false,storageProbeOnce=false,
  hostingPreflightOnce=false,qualificationDeployOnlyOnce=false,hold='',hostedConfigured='',privatePilot='success',windowsPreview='skipped'
}={}){
  return event==='workflow_dispatch'&&equalsExpressionString(branch,'main')&&rollbackDrillOnce===true&&
    qualifyOnce!==true&&storageProbeOnce!==true&&hostingPreflightOnce!==true&&qualificationDeployOnlyOnce!==true&&
    equalsExpressionString(hold,'true')&&equalsExpressionString(hostedConfigured,'true')&&
    privatePilot==='success'&&['success','skipped'].includes(windowsPreview)?'run':'skipped';
}

export function qualificationDeployOnlyPolicy({
  event='push',branch='main',qualificationDeployOnlyOnce=false,qualifyOnce=false,storageProbeOnce=false,
  hostingPreflightOnce=false,rollbackDrillOnce=false,rollbackPreviousSha='',cancelled=false,
  hold='',hostedConfigured=''
}={}){
  return !cancelled&&event==='workflow_dispatch'&&equalsExpressionString(branch,'main')&&
    qualificationDeployOnlyOnce===true&&qualifyOnce!==true&&storageProbeOnce!==true&&hostingPreflightOnce!==true&&
    rollbackDrillOnce!==true&&(rollbackPreviousSha===''||equalsExpressionString(rollbackPreviousSha,qualificationFallback))&&
    equalsExpressionString(hold,'true')&&
    equalsExpressionString(hostedConfigured,'true')?'run':'skipped';
}

export function qualificationDeploymentSource(main,previous=''){
  if(!/^[a-f0-9]{40}$/.test(main??'')||(previous!==''&&previous!==qualificationFallback)){
    throw Error('Only the exact main SHA or the pinned Qualification fallback can be deployed.');
  }
  return {sha:previous||main,restore:previous!==''};
}

export async function verifiedQualificationPushRun({repository,repositoryId,sha,fetcher=fetch}){
  const repoId=Number(repositoryId);
  if(!/^[a-zA-Z0-9-]+\/[a-zA-Z0-9][a-zA-Z0-9_.-]*$/.test(repository??'')||
      !Number.isSafeInteger(repoId)||repoId<1||!/^[a-f0-9]{40}$/.test(sha??'')){
    throw Error('The exact Qualification source identity is missing.');
  }
  const workflow='justelle-private-app.yml';
  const api=`https://api.github.com/repos/${repository}/actions`;
  const read=async path=>{
    const response=await fetcher(api+path,{headers:{Accept:'application/vnd.github+json'},
      redirect:'error',signal:AbortSignal.timeout(10_000)});
    if(!response.ok)throw Error('GitHub Actions source evidence is unavailable.');
    return response.json();
  };
  const query=new URLSearchParams({branch:'main',event:'push',head_sha:sha,status:'success',per_page:'10'});
  const history=await read(`/workflows/${workflow}/runs?${query}`);
  const positiveInteger=value=>Number.isSafeInteger(value)&&value>0;
  const run=history.workflow_runs?.find(item=>
    positiveInteger(item?.id)&&positiveInteger(item.run_attempt)&&item.repository?.id===repoId&&
    item.head_repository?.id===repoId&&item.path===`.github/workflows/${workflow}`&&
    item.event==='push'&&item.head_branch==='main'&&item.head_sha===sha&&
    item.status==='completed'&&item.conclusion==='success');
  if(!run)throw Error('A successful main push run for the exact Qualification source is required.');

  const receipt=await read(`/runs/${run.id}/attempts/${run.run_attempt}/jobs?per_page=100`);
  for(const name of ['changes','private-pilot','Windows preview shutdown']){
    const matches=receipt.jobs?.filter(job=>job?.name===name);
    const job=matches?.[0];
    if(matches?.length!==1||job.run_id!==run.id||job.run_attempt!==run.run_attempt||
        job.head_sha!==sha||job.status!=='completed'||job.conclusion!=='success'){
      throw Error('The exact main push attempt did not pass all required source checks.');
    }
  }
  return {id:run.id,run_attempt:run.run_attempt};
}

export function requireQualificationDeployWindow(cutoff,now=Date.now(),budget=30){
  const end=Date.parse(cutoff);
  const minute=60_000;
  if(!/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\dZ$/.test(cutoff??'')||!Number.isFinite(end)||
      new Date(end).toISOString()!==cutoff.replace('Z','.000Z')||
      end-now<budget*minute||end-now>60*minute){
    throw Error(`The deploy cutoff must leave the full ${budget}-minute job budget before the reserved interval.`);
  }
}
