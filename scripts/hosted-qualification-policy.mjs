// Executable model of the release gate semantics tested against the workflow.
const equalsExpressionString=(actual,expected)=>typeof actual==='string'&&
  actual.toLowerCase()===expected.toLowerCase();

export function hostedQualificationPolicy({
  event='push',branch='main',hold='',hostedConfigured='',initialAcceptance='',hostedChanges=false,
  privatePilot='success',windowsPreview='skipped',qualificationResult='skipped'
}={}){
  const isPullRequest=event==='pull_request';
  const prerequisites=privatePilot==='success'&&['success','skipped'].includes(windowsPreview);
  const held=!isPullRequest&&equalsExpressionString(hold,'true');
  const qualificationRequired=!isPullRequest&&prerequisites&&!held&&equalsExpressionString(hostedConfigured,'true')&&
    (!equalsExpressionString(initialAcceptance,'verified')||hostedChanges);
  const productionAllowed=!isPullRequest&&!held&&equalsExpressionString(branch,'main')&&
    equalsExpressionString(initialAcceptance,'verified')&&prerequisites&&
    (equalsExpressionString(qualificationResult,'success')||
      (!hostedChanges&&equalsExpressionString(qualificationResult,'skipped')));
  return {
    qualification:qualificationRequired?'run':'skipped',
    holdReport:held?'held':'not-applicable',
    production:productionAllowed?'run':'skipped'
  };
}
