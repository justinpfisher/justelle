// Executable model of the release gate semantics tested against the workflow.
const equalsExpressionString=(actual,expected)=>typeof actual==='string'&&
  actual.toLowerCase()===expected.toLowerCase();

export function hostedQualificationPolicy({
  event='push',branch='main',hold='',hostedConfigured='',initialAcceptance='',hostedChanges=false,
  privatePilot='success',windowsPreview='skipped',qualificationResult='skipped',qualifyOnce=false,
  storageProbeOnce=false
}={}){
  const isPullRequest=event==='pull_request';
  const prerequisites=privatePilot==='success'&&['success','skipped'].includes(windowsPreview);
  const held=!isPullRequest&&equalsExpressionString(hold,'true');
  const manualQualification=event==='workflow_dispatch'&&equalsExpressionString(branch,'main')&&qualifyOnce===true&&storageProbeOnce!==true;
  const configured=equalsExpressionString(hostedConfigured,'true');
  const acceptanceGate=!equalsExpressionString(initialAcceptance,'verified')||hostedChanges;
  const qualificationEligible=prerequisites&&configured&&acceptanceGate;
  const qualificationRequired=!isPullRequest&&qualificationEligible&&(!held||manualQualification);
  const productionAllowed=!isPullRequest&&storageProbeOnce!==true&&!held&&equalsExpressionString(branch,'main')&&
    equalsExpressionString(initialAcceptance,'verified')&&prerequisites&&
    (equalsExpressionString(qualificationResult,'success')||
      (!hostedChanges&&equalsExpressionString(qualificationResult,'skipped')));
  return {
    qualification:qualificationRequired?'run':'skipped',
    holdReport:held&&!(manualQualification&&qualificationEligible)?'held':'not-applicable',
    production:productionAllowed?'run':'skipped'
  };
}

export function firebaseStorageProbePolicy({
  event='push',branch='main',storageProbeOnce=false,qualifyOnce=false,hold='',hostedConfigured='',
  privatePilot='success',windowsPreview='skipped'
}={}){
  const prerequisites=privatePilot==='success'&&['success','skipped'].includes(windowsPreview);
  return event==='workflow_dispatch'&&equalsExpressionString(branch,'main')&&
    storageProbeOnce===true&&qualifyOnce!==true&&equalsExpressionString(hold,'true')&&
    equalsExpressionString(hostedConfigured,'true')&&prerequisites?'run':'skipped';
}
