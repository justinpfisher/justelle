import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {hostedQualificationPolicy} from './hosted-qualification-policy.mjs';

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

test('production guard remains byte-for-byte unchanged while manual qualification is held',()=>{
  const release=job('production-release');
  assert.match(release,/github\.ref == 'refs\/heads\/main' &&\s*vars\.JUSTELLE_HOSTED_QUALIFICATION_HOLD != 'true' &&\s*vars\.JUSTELLE_INITIAL_ACCEPTANCE == 'verified'/);
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
