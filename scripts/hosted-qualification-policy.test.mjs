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

test('hold blocks hosted qualification and production regardless of acceptance or change scope',()=>{
  for(const initialAcceptance of ['', 'verified'])for(const hostedChanges of [false,true]){
    const result=hostedQualificationPolicy({hold:'true',hostedConfigured:'true',initialAcceptance,
      hostedChanges,qualificationResult:'skipped'});
    assert.deepEqual(result,{qualification:'skipped',holdReport:'held',production:'skipped'});
  }
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
