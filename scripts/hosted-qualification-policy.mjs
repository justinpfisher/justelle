// Executable model of the release gate semantics tested against the workflow.
export function hostedQualificationPolicy({
  event='push',branch='main',hold='',hostedConfigured='',initialAcceptance='',hostedChanges=false,
  privatePilot='success',windowsPreview='skipped',qualificationResult='skipped'
}={}){
  const isPullRequest=event==='pull_request';
  const prerequisites=privatePilot==='success'&&['success','skipped'].includes(windowsPreview);
  const held=!isPullRequest&&hold==='true';
  const qualificationRequired=!isPullRequest&&prerequisites&&!held&&hostedConfigured==='true'&&
    (initialAcceptance!=='verified'||hostedChanges);
  const productionAllowed=!isPullRequest&&!held&&branch==='main'&&initialAcceptance==='verified'&&
    prerequisites&&(qualificationResult==='success'||(!hostedChanges&&qualificationResult==='skipped'));
  return {
    qualification:qualificationRequired?'run':'skipped',
    holdReport:held?'held':'not-applicable',
    production:productionAllowed?'run':'skipped'
  };
}
