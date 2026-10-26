import {test} from 'node:test';
import assert from 'node:assert/strict';
import {release,disableInitialService} from '../hosting/release-core.mjs';
import {qualificationDrill,checkQualificationClosed} from '../hosting/qualification-drill.mjs';
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

test('First-release shutdown attempts Hosting even when Cloud Run IAM removal fails',async()=>{
 for(const failure of ['run','hosting','both']){
   const calls=[];
   const close=()=>disableInitialService({
     removePublicInvoker:async()=>{calls.push('remove-run-public-access');
       if(failure==='run'||failure==='both')throw Error('Synthetic IAM failure with sensitive details');},
     disableHosting:async()=>{calls.push('disable-hosting');
       if(failure==='hosting'||failure==='both')throw Error('Synthetic Firebase failure with sensitive details');}
   });
   await assert.rejects(close(),/operator recovery required/);
   assert.deepEqual(calls,['remove-run-public-access','disable-hosting']);
 }
 const calls=[];
 await disableInitialService({removePublicInvoker:async()=>calls.push('run'),
   disableHosting:async()=>calls.push('hosting')});
 assert.deepEqual(calls,['run','hosting']);
});
test('Failed initial rollback never reports success when either public shutdown is incomplete',async()=>{
 const calls=[];
 const initial=setup({failure:'check',previous:false});
 await assert.rejects(release({...initial.options,failClosed:()=>disableInitialService({
   removePublicInvoker:async()=>{calls.push('remove-run');throw Error('Synthetic denied');},
   disableHosting:async()=>{calls.push('disable-hosting');}
 })}),/immediate operator attention/);
 assert.deepEqual(calls,['remove-run','disable-hosting']);
 assert.equal(initial.calls.some(x=>x[0]==='record'),false);
 assert.deepEqual(initial.calls.at(-1),['report','recovery-failed']);
});

const fictionalConfig={mode:'hosted-fictional',projectId:'justelle-qualification',
 otherProjectId:'justelle-production',site:'justelle-qualification',
 origin:'https://justelle-qualification.web.app',roomId:'fictional-room',apiKey:'synthetic',
 gatewayServiceAccount:'gateway@justelle-qualification.iam.gserviceaccount.com',
 backupServiceAccount:'backup@justelle-qualification.iam.gserviceaccount.com'};
function drillSetup(){
 const calls=[];let deployed=sha;
 return {calls,options:{config:fictionalConfig,sha,previousSha:old,
  deploy:async version=>{calls.push(['deploy',version]);deployed=version;},
  check:async version=>{calls.push(['check',version]);assert.equal(deployed,version);},
  failClosed:async()=>{calls.push(['disable']);deployed=null;},
  checkClosed:async()=>{calls.push(['check-closed']);assert.equal(deployed,null);},
  report:async result=>calls.push(['report',result])}};
}
test('Fictional cloud drill exercises automatic rollback and initial shutdown then restores exact starting source',async()=>{
 const s=drillSetup();assert.equal((await qualificationDrill(s.options)).verified,true);
 assert.deepEqual(s.calls.filter(c=>c[0]==='deploy').map(c=>c[1]),[old,sha,old,sha,sha]);
 assert.deepEqual(s.calls.slice(-3,-1),[['deploy',sha],['check',sha]]);
 assert.equal(s.calls.at(-1)[1].status,'qualification-drill-verified');
 assert.equal(s.calls.at(-1)[1].previousSha,old);
 assert.equal(s.calls.filter(c=>c[0]==='check-closed').length,1);
});
test('Drill rejects production, ambiguous site, shared projects and invalid revisions before cloud callbacks',async()=>{
 for(const patch of [{config:{...fictionalConfig,mode:'production'}},
  {config:{...fictionalConfig,mode:'production',roomId:'real-room',origin:'https://app.justelle.life'}},
  {config:{...fictionalConfig,origin:'https://app.justelle.life'}},
  {config:{...fictionalConfig,site:'different-fictional-site'}},
  {config:{...fictionalConfig,otherProjectId:fictionalConfig.projectId}},
  {config:{...fictionalConfig,roomId:'real-room'}},
  {previousSha:sha},{previousSha:'main'}]){
  const s=drillSetup();await assert.rejects(qualificationDrill({...s.options,...patch}));
  assert.deepEqual(s.calls,[]);
 }
});
test('Unexpected cloud failure cannot count as injected failure and still restores starting source',async()=>{
 for(const fault of ['staging','candidate','rollback','shutdown','closed-check']){
  const s=drillSetup();let oldDeploys=0;
  const deploy=async version=>{
   if(version===old)oldDeploys++;
   if((fault==='staging'&&version===old&&oldDeploys===1)||
    (fault==='candidate'&&version===sha&&oldDeploys===1)||
    (fault==='rollback'&&version===old&&oldDeploys===2)){
     // Fail once so restoration itself is independent of the injected fault.
     oldDeploys=3;throw Error('Synthetic provider failure');
   }
   await s.options.deploy(version);
  };
  await assert.rejects(qualificationDrill({...s.options,deploy,
   failClosed:fault==='shutdown'?async()=>{throw Error('IAM denied');}:s.options.failClosed,
   checkClosed:fault==='closed-check'?async()=>{throw Error('Still public');}:s.options.checkClosed}));
  assert.deepEqual(s.calls.slice(-3,-1),[['deploy',sha],['check',sha]]);
  assert.equal(s.calls.at(-1)[1].status,'qualification-drill-failed-restored');
 }
});
test('Unverified starting service is untouched; failed restoration is reported as requiring recovery',async()=>{
 const s=drillSetup();await assert.rejects(qualificationDrill({...s.options,
  check:async()=>{throw Error('Wrong initial SHA');}}));assert.deepEqual(s.calls,[]);
 const r=drillSetup();let currentDeploys=0;
 await assert.rejects(qualificationDrill({...r.options,deploy:async version=>{
  if(version===sha&&++currentDeploys===3)throw Error('Restore failed');
  await r.options.deploy(version);
 }}));
 assert.equal(r.calls.at(-1)[1].status,'qualification-drill-recovery-failed');
});
test('Cloud shutdown needs actual denied HTTP responses, not an outage or a still-serving page',async()=>{
 const origin=fictionalConfig.origin;
 await checkQualificationClosed(origin,async()=>new Response('',{status:404}));
 for(const status of [200,301,500])await assert.rejects(checkQualificationClosed(origin,
  async()=>new Response('',{status})));
 await assert.rejects(checkQualificationClosed(origin,async()=>{throw Error('Network unavailable');}));
 await assert.rejects(checkQualificationClosed('https://app.justelle.life',async()=>{
  throw Error('Production must never be contacted');
 }));
});
