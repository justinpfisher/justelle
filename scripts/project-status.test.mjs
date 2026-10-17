import test from 'node:test';
import assert from 'node:assert/strict';
import {acceptanceItems,calculateMilestones,renderFrontPage,renderDetails,replaceReadmeStatus} from './update-project-status.mjs';

const def={schema:1,milestones:[
  {id:'M0',issue:20,title:'Foundation',release:'Foundation'},
  {id:'M1',issue:21,title:'Storage',release:'V1'},
  {id:'M4',issue:24,title:'Launch',release:'V1'}
]};
const issue=(number,title,flags,state='open')=>({number,title,state,body:`## Outcome\nExample\n\n## Acceptance checklist\n${flags.map(x=>`- [${x?'x':' '}] Criterion ${x?'met':'unmet'}`).join('\n')}\n\n## Evidence and updating this milestone\n- [ ] This is not an acceptance checkbox.`});
const issues=()=>new Map([
  [20,issue(20,'M0 — Foundation',[true,true],'closed')],
  [21,issue(21,'M1 — Storage',[false,true])],
  [24,issue(24,'M4 — Launch',[false])]
]);

test('count only the dedicated acceptance checklist',()=>{
  const xs=acceptanceItems(issue(3,'example',[true,false,false]).body);
  assert.equal(xs.length,3);assert.equal(xs.filter(i=>i.done).length,1);
});
test('development foundation is complete but source PR cannot assert live deployment',()=>{
  const s=calculateMilestones(def,issues(),{state:'open',draft:true,merged_at:null});
  assert.equal(s.completed,1);assert.equal(s.ready,false);assert.equal(s.next.id,'M1');
  assert.equal(s.rows[0].status,'Complete');assert.equal(s.rows[1].status,'Current');
  assert.match(renderFrontPage(s),/NOT VERIFIED LIVE/);
  assert.match(renderDetails(s),/not a qualified public-facing private planner/);
  assert.match(renderFrontPage(s),/Draft development PR/);
});
test('closing an issue with unchecked criteria never counts as accepted',()=>{
  const m=issues();m.set(21,issue(21,'M1 — Storage',[false,true],'closed'));
  const s=calculateMilestones(def,m,{state:'closed',merged_at:'2026-10-01'});
  assert.equal(s.rows[1].status,'Review needed');assert.equal(s.ready,false);
});
test('fully checked open issue needs review; all closed V1 criteria can complete release checklist',()=>{
  const m=issues();m.set(21,issue(21,'M1 — Storage',[true,true]));
  assert.equal(calculateMilestones(def,m,null).rows[1].status,'Ready for review');
  m.set(21,issue(21,'M1 — Storage',[true,true],'closed'));
  m.set(24,issue(24,'M4 — Launch',[true],'closed'));
  assert.equal(calculateMilestones(def,m,null).ready,true);
});
test('malformed issue checklists fail closed',()=>{
  assert.throws(()=>acceptanceItems('## Other\n- [x] fake'),/missing/);
  const m=issues();m.set(20,issue(20,'Milestone A',[true],'closed'));
  assert.throws(()=>calculateMilestones(def,m,null),/unexpected title/);
});
test('README insertion and repeated automatic updates are idempotent',()=>{
  const base='# Justelle. Still us.\n\nOriginal site instructions.\n';
  const block=renderFrontPage(calculateMilestones(def,issues(),null));
  const once=replaceReadmeStatus(base,block);
  assert.equal(replaceReadmeStatus(once,block),once);
  assert.match(once,/Original site instructions/);
  assert.equal((once.match(/JUSTELLE_MILESTONE_STATUS_START/g)||[]).length,1);
  assert.throws(()=>replaceReadmeStatus('# Title\n<!-- JUSTELLE_MILESTONE_STATUS_END -->',block),/Malformed/);
});
