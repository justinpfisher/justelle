// Executable model of the release gate semantics tested against the workflow.
const equalsExpressionString=(actual,expected)=>typeof actual==='string'&&
  actual.toLowerCase()===expected.toLowerCase();

export function hostedQualificationPolicy({
  event='push',branch='main',hold='',hostedConfigured='',initialAcceptance='',hostedChanges=false,
  privatePilot='success',windowsPreview='skipped',qualificationResult='skipped',qualifyOnce=false
}={}){
  const isPullRequest=event==='pull_request';
  const prerequisites=privatePilot==='success'&&['success','skipped'].includes(windowsPreview);
  const held=!isPullRequest&&equalsExpressionString(hold,'true');
  const manualQualification=event==='workflow_dispatch'&&equalsExpressionString(branch,'main')&&qualifyOnce===true;
  const configured=equalsExpressionString(hostedConfigured,'true');
  const acceptanceGate=!equalsExpressionString(initialAcceptance,'verified')||hostedChanges;
  const qualificationEligible=prerequisites&&configured&&acceptanceGate;
  const qualificationRequired=!isPullRequest&&qualificationEligible&&(!held||manualQualification);
  const productionAllowed=!isPullRequest&&!held&&equalsExpressionString(branch,'main')&&
    equalsExpressionString(initialAcceptance,'verified')&&prerequisites&&
    (equalsExpressionString(qualificationResult,'success')||
      (!hostedChanges&&equalsExpressionString(qualificationResult,'skipped')));
  return {
    qualification:qualificationRequired?'run':'skipped',
    holdReport:held&&!(manualQualification&&qualificationEligible)?'held':'not-applicable',
    production:productionAllowed?'run':'skipped'
  };
}
