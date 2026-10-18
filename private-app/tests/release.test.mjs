import {test} from 'node:test';
import assert from 'node:assert/strict';
import {release} from '../hosting/release-core.mjs';
const sha='a'.repeat(40),old='b'.repeat(40);
function setup({failure=null,previous=true,rollbackFailure=false}={}){
  const calls=[];
  return {calls,options:{sha,qualified:true,readLastGood:async()=>previous?{sha:old}:null,
    deploy:async v=>{calls.push(['deploy',v]);if(failure==='deploy')throw Error('Deployment failed');},
    check:async v=>{calls.push(['check',v]);if(v===sha&&failure==='check')throw Error('Smoke failed');},
    recordGood:async v=>calls.push(['record',v.sha]),rollback:async v=>{calls.push(['rollback',v]);if(rollbackFailure)throw Error('Rollback failed');},
    failClosed:async()=>calls.push(['disable']),report:async v=>calls.push(['report',v.status])}};
}
test('Only verified releases become the known-good source',async()=>{
  const s=setup();assert.equal((await release(s.options)).status,'verified');
  assert.deepEqual(s.calls,[['deploy',sha],['check',sha],['record',sha],['report','verified']]);
  const denied=setup();await assert.rejects(release({...denied.options,qualified:false}),/qualified/);assert.equal(denied.calls.length,0);
});
test('Partial deployment and smoke failures restore exact prior source and verify it without changing history',async()=>{
  for(const failure of ['deploy','check']){
    const s=setup({failure});await assert.rejects(release(s.options),/previous service/);
    assert.deepEqual(s.calls.slice(-4),[['rollback',old],['check',old],['record',old],['report','rolled-back']]);assert.equal(s.calls.some(c=>c[0]==='record'&&c[1]===sha),false);
  }
});
test('First-release failure disables service; failed rollback produces an explicit recovery failure',async()=>{
  const initial=setup({failure:'check',previous:false});await assert.rejects(release(initial.options));assert.deepEqual(initial.calls.slice(-2),[['disable'],['report','disabled']]);
  const broken=setup({failure:'check',rollbackFailure:true});await assert.rejects(release(broken.options),/immediate operator/);assert.deepEqual(broken.calls.at(-1),['report','recovery-failed']);
});
