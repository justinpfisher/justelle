import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {hostedQualificationPolicy,firebaseStorageProbePolicy} from './hosted-qualification-policy.mjs';

const workflow=readFileSync(new URL('../.github/workflows/justelle-private-app.yml',import.meta.url),'utf8');
const job=(id)=>{
  const start=workflow.indexOf(`  ${id}:`);
  assert.notEqual(start,-1,`workflow job ${id} exists`);
  const boundary=/\n  [a-z][a-z0-9-]*:\r?\n/g;
  boundary.lastIndex=start+3;
  const next=boundary.exec(workflow)?.index??-1;
  return workflow.slice(start,next<0?undefined:next);
};

test('workflow has a non-privileged held-status job and guards both provider deployment jobs',()=>{
  const held=job('hosted-qualification-hold');
  assert.match(held,/name: Hosted qualification held \(not run\)/);
  assert.match(held,/vars\.JUSTELLE_HOSTED_QUALIFICATION_HOLD == 'true'/);
  assert.match(held,/held; no provider deployment ran and no acceptance evidence was recorded/);
  assert.doesNotMatch(held,/id-token:\s*write|hosting\/deploy\.mjs|JUSTELLE_DEPLOY_CONFIG/);
  assert.match(job('hosted-qualification'),/vars\.JUSTELLE_HOSTED_QUALIFICATION_HOLD != 'true'/);
  assert.match(job('production-release'),/vars\.JUSTELLE_HOSTED_QUALIFICATION_HOLD != 'true'/);
});

test('manual one-run qualification input is opt-in and restricted to main',()=>{
  assert.match(workflow,/workflow_dispatch:\s*\n\s+inputs:\s*\n\s+qualify_once:\s*\n\s+description: Run one hosted fictional qualification from main while the persistent hold remains active\s*\n\s+type: boolean\s*\n\s+required: false\s*\n\s+default: false/);
  assert.match(job('hosted-qualification'),/github\.event_name == 'workflow_dispatch' && github\.ref == 'refs\/heads\/main' && inputs\.qualify_once == true/);
  assert.match(job('hosted-qualification-hold'),/inputs\.qualify_once == true/);
  assert.doesNotMatch(job('production-release'),/inputs\.qualify_once|workflow_dispatch/);
});

test('read-only Hosting preflight is opt-in, main-only, held-only and isolated from deployment',()=>{
  assert.match(workflow,/hosting_preflight_once:\s*\n\s+description: Run one read-only qualification Hosting site readiness check from main without deployment\s*\n\s+type: boolean\s*\n\s+required: false\s*\n\s+default: false/);
  const preflight=job('qualification-hosting-preflight');
  assert.match(preflight,/github\.event_name == 'workflow_dispatch'/);
  assert.match(preflight,/github\.ref == 'refs\/heads\/main'/);
  assert.match(preflight,/inputs\.hosting_preflight_once == true/);
  assert.match(preflight,/inputs\.qualify_once != true/);
  assert.match(preflight,/inputs\.storage_probe_once != true/);
  assert.match(preflight,/vars\.JUSTELLE_HOSTED_QUALIFICATION_HOLD == 'true'/);
  assert.match(preflight,/vars\.JUSTELLE_HOSTED_CONFIGURED == 'true'/);
  assert.match(preflight,/environment: justelle-qualification/);
  assert.match(preflight,/secrets\.JUSTELLE_WIF_PROVIDER/);
  assert.match(preflight,/secrets\.JUSTELLE_DEPLOY_SERVICE_ACCOUNT/);
  assert.match(preflight,/secrets\.JUSTELLE_DEPLOY_CONFIG/);
  assert.match(preflight,/hosting\/qualification-site-preflight\.mjs/);
  assert.match(preflight,/if: always\(\)/);
  assert.doesNotMatch(preflight,/hosting\/deploy\.mjs|accept-hosted\.mjs|gcloud secrets|JUSTELLE_BACKUP_CONFIG|npm run build/);
  assert.match(job('hosted-qualification'),/inputs\.hosting_preflight_once != true/);
  assert.match(job('production-release'),/inputs\.hosting_preflight_once != true/);
  assert.match(job('firebase-storage-default-bucket-probe'),/inputs\.hosting_preflight_once != true/);
  assert.match(job('hosted-qualification-hold'),/inputs\.hosting_preflight_once != true/);
});

test('read-only Hosting preflight requires only the held main dispatch and never qualifies or releases',()=>{
  const common={event:'workflow_dispatch',branch:'main',hostingPreflightOnce:true,qualifyOnce:false,
    storageProbeOnce:false,hold:'true',hostedConfigured:'true',privatePilot:'success',windowsPreview:'skipped'};
  assert.deepEqual(hostedQualificationPolicy(common),{
    qualification:'skipped',holdReport:'not-applicable',production:'skipped',hostingPreflight:'run'
  });
  for(const overrides of [
    {event:'pull_request'},
    {branch:'feature'},
    {hold:'false'},
    {hostedConfigured:'false'},
    {privatePilot:'failure'},
    {windowsPreview:'failure'},
    {qualifyOnce:true},
    {storageProbeOnce:true}
  ]){
    const result=hostedQualificationPolicy({...common,...overrides});
    assert.equal(result.hostingPreflight,'skipped');
    assert.equal(result.production,'skipped');
  }
  assert.equal(firebaseStorageProbePolicy({...common,storageProbeOnce:true}), 'skipped');
});

test('production guard remains ineligible for a read-only probe and retains its existing acceptance conditions',()=>{
  const release=job('production-release');
  assert.match(release,/github\.ref == 'refs\/heads\/main' &&\s*inputs\.storage_probe_once != true &&\s*inputs\.hosting_preflight_once != true &&\s*vars\.JUSTELLE_HOSTED_QUALIFICATION_HOLD != 'true' &&\s*vars\.JUSTELLE_INITIAL_ACCEPTANCE == 'verified'/);
  assert.doesNotMatch(release,/qualify_once|workflow_dispatch/);
});

test('hold blocks hosted qualification and production regardless of acceptance or change scope',()=>{
  for(const initialAcceptance of ['', 'verified'])for(const hostedChanges of [false,true]){
    const result=hostedQualificationPolicy({hold:'true',hostedConfigured:'true',initialAcceptance,
      hostedChanges,qualificationResult:'skipped'});
    assert.deepEqual(result,{qualification:'skipped',holdReport:'held',production:'skipped'});
  }
});

test('explicit main workflow dispatch can run qualification while persistent hold remains active, never production',()=>{
  assert.deepEqual(hostedQualificationPolicy({event:'workflow_dispatch',branch:'main',qualifyOnce:true,
    hold:'true',hostedConfigured:'true',initialAcceptance:'',qualificationResult:'success'}),
  {qualification:'run',holdReport:'not-applicable',production:'skipped'});
  assert.deepEqual(hostedQualificationPolicy({event:'workflow_dispatch',branch:'main',qualifyOnce:true,
    hold:'true',hostedConfigured:'true',initialAcceptance:'verified',hostedChanges:true,
    qualificationResult:'success'}),
  {qualification:'run',holdReport:'not-applicable',production:'skipped'});
});

test('manual request cannot bypass hold outside main, without opt-in, or when qualification prerequisites fail',()=>{
  const common={event:'workflow_dispatch',qualifyOnce:true,hold:'true',hostedConfigured:'true',initialAcceptance:'',qualificationResult:'success'};
  assert.deepEqual(hostedQualificationPolicy({...common,branch:'feature'}),
    {qualification:'skipped',holdReport:'held',production:'skipped'});
  assert.deepEqual(hostedQualificationPolicy({...common,branch:'main',qualifyOnce:false}),
    {qualification:'skipped',holdReport:'held',production:'skipped'});
  assert.deepEqual(hostedQualificationPolicy({...common,branch:'main',privatePilot:'failure'}),
    {qualification:'skipped',holdReport:'held',production:'skipped'});
  assert.deepEqual(hostedQualificationPolicy({...common,branch:'main',hostedConfigured:'false'}),
    {qualification:'skipped',holdReport:'held',production:'skipped'});
  assert.deepEqual(hostedQualificationPolicy({...common,branch:'main',initialAcceptance:'verified',hostedChanges:false}),
    {qualification:'skipped',holdReport:'held',production:'skipped'});
});

test('pull request manual inputs never run hosted qualification or production',()=>{
  assert.deepEqual(hostedQualificationPolicy({event:'pull_request',branch:'main',qualifyOnce:true,hold:'true',
    hostedConfigured:'true',initialAcceptance:'',qualificationResult:'success'}),
  {qualification:'skipped',holdReport:'not-applicable',production:'skipped'});
});

test('hold matching is case-insensitive like GitHub expressions and does not trim whitespace',()=>{
  for(const hold of ['TRUE','TrUe']){
    assert.deepEqual(hostedQualificationPolicy({hold,hostedConfigured:'TRUE',initialAcceptance:'VERIFIED',
      hostedChanges:false,qualificationResult:'skipped'}),
    {qualification:'skipped',holdReport:'held',production:'skipped'});
  }
  assert.deepEqual(hostedQualificationPolicy({hold:' true ',hostedConfigured:'true',initialAcceptance:'',
    hostedChanges:false,qualificationResult:'skipped'}),
  {qualification:'run',holdReport:'not-applicable',production:'skipped'});
  assert.deepEqual(hostedQualificationPolicy({hostedConfigured:'true',initialAcceptance:'',
    qualificationResult:'skipped'}),
  {qualification:'run',holdReport:'not-applicable',production:'skipped'});
});

test('unpaused first qualification runs but cannot release production before acceptance',()=>{
  assert.deepEqual(hostedQualificationPolicy({hostedConfigured:'true',initialAcceptance:'',
    qualificationResult:'skipped'}),
  {qualification:'run',holdReport:'not-applicable',production:'skipped'});
});

test('unpaused accepted interface release keeps existing no-qualification path',()=>{
  assert.deepEqual(hostedQualificationPolicy({hostedConfigured:'true',initialAcceptance:'verified',
    hostedChanges:false,qualificationResult:'skipped'}),
  {qualification:'skipped',holdReport:'not-applicable',production:'run'});
});

test('unpaused hosted-sensitive changes release only after qualification succeeds',()=>{
  const common={hostedConfigured:'true',initialAcceptance:'verified',hostedChanges:true};
  assert.equal(hostedQualificationPolicy({...common,qualificationResult:'skipped'}).production,'skipped');
  assert.equal(hostedQualificationPolicy({...common,qualificationResult:'success'}).production,'run');
});

test('pull requests keep source checks but never report a release hold or run provider jobs',()=>{
  assert.deepEqual(hostedQualificationPolicy({event:'pull_request',hold:'true',hostedConfigured:'true',
    initialAcceptance:'',qualificationResult:'skipped'}),
  {qualification:'skipped',holdReport:'not-applicable',production:'skipped'});
});

test('Storage metadata probe is opt-in, main-only, held-only and separate from deployment jobs',()=>{
  assert.match(workflow,/storage_probe_once:\s*\n\s+description: Run one read-only Firebase Storage default-bucket metadata probe from main while qualification remains held\s*\n\s+type: boolean\s*\n\s+required: false\s*\n\s+default: false/);
  const probe=job('firebase-storage-default-bucket-probe');
  assert.match(probe,/github\.event_name == 'workflow_dispatch'/);
  assert.match(probe,/github\.ref == 'refs\/heads\/main'/);
  assert.match(probe,/inputs\.storage_probe_once == true/);
  assert.match(probe,/inputs\.qualify_once != true/);
  assert.match(probe,/vars\.JUSTELLE_HOSTED_QUALIFICATION_HOLD == 'true'/);
  assert.match(probe,/environment: justelle-qualification/);
  assert.match(probe,/id-token:\s*write/);
  assert.match(probe,/secrets\.JUSTELLE_WIF_PROVIDER/);
  assert.match(probe,/secrets\.JUSTELLE_DEPLOY_SERVICE_ACCOUNT/);
  assert.doesNotMatch(probe,/JUSTELLE_DEPLOY_CONFIG|JUSTELLE_BACKUP_CONFIG|hosting\/deploy\.mjs|accept-hosted\.mjs|gcloud secrets/);
  assert.match(job('hosted-qualification'),/inputs\.storage_probe_once != true/);
  assert.match(job('production-release'),/inputs\.storage_probe_once != true/);
});

test('read-only probe model allows only a held main workflow dispatch after source prerequisites',()=>{
  const common={event:'workflow_dispatch',branch:'main',storageProbeOnce:true,hold:'true',
    hostedConfigured:'true',privatePilot:'success',windowsPreview:'skipped'};
  assert.equal(firebaseStorageProbePolicy(common),'run');
  assert.deepEqual(hostedQualificationPolicy({...common,qualifyOnce:false,initialAcceptance:'verified',
    hostedChanges:false,qualificationResult:'skipped'}),{
      qualification:'skipped',holdReport:'held',production:'skipped'
    });
});

test('probe cannot run on PR, another ref, without hold/configuration/prerequisites, or alongside deployment',()=>{
  const common={event:'workflow_dispatch',branch:'main',storageProbeOnce:true,hold:'true',
    hostedConfigured:'true',privatePilot:'success',windowsPreview:'skipped'};
  for(const overrides of [
    {event:'pull_request'},
    {branch:'feature'},
    {hold:'false'},
    {hostedConfigured:'false'},
    {privatePilot:'failure'},
    {windowsPreview:'failure'},
    {qualifyOnce:true}
  ])assert.equal(firebaseStorageProbePolicy({...common,...overrides}),'skipped');
  const both={...common,qualifyOnce:true,initialAcceptance:'',qualificationResult:'success'};
  assert.deepEqual(hostedQualificationPolicy(both),{
    qualification:'skipped',holdReport:'held',production:'skipped'
  });
});


test('probe selector cannot qualify or release when the persistent hold is false',()=>{
  const input={event:'workflow_dispatch',branch:'main',storageProbeOnce:true,qualifyOnce:false,hold:'false',
    hostedConfigured:'true',initialAcceptance:'verified',hostedChanges:true,privatePilot:'success',
    windowsPreview:'skipped',qualificationResult:'success'};
  assert.equal(firebaseStorageProbePolicy(input),'skipped');
  assert.deepEqual(hostedQualificationPolicy(input),{
    qualification:'skipped',holdReport:'not-applicable',production:'skipped'
  });
});

