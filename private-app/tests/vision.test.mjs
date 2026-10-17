import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createVisionProvider} from '../ai/vision-provider.mjs';
const imageId='00000000-0000-4000-8000-000000000001';
const input={message:{id:'fictional-message',body:'Discuss a fictional image',conversation_id:'conversation-shared',attachment_ids:[imageId]},context:{room_id:'fictional-room',messages:[{conversation_id:'another-thread',body:'Do not disclose unrelated context'}]},permission:{roomId:'fictional-room',conversationId:'conversation-shared',sourceMessageId:'fictional-message',personId:'person-a'},images:[{id:imageId,mime:'image/png',bytes:Uint8Array.from([1,2,3])}]};
const output={reply:'A fictional image-aware response.',proposal:{body:'Fictional suggestion',why:'Both people decide.'}};
function setup({inputTokens=100,responseStatus=200,response=output,denyBudget=false,replayed=false}={}){
  const calls=[],reservations=[],completed=[];
  const budget={reserve:async r=>{reservations.push(r);if(denyBudget)throw Error('Allowance reached');return {replayed,result:output};},complete:async r=>{completed.push(r);}};
  const options={approved:true,apiKey:'fictional-server-key',model:'fictional-vision-model',pricing:{model:'fictional-vision-model',inputCadMicrosPerMillion:1000000,outputCadMicrosPerMillion:2000000,validUntil:'2099-01-01T00:00:00Z'},budget,
    fetchImpl:async(url,o)=>{calls.push({url,options:o,body:JSON.parse(o.body)});return url.endsWith('/input_tokens')?Response.json({input_tokens:inputTokens}):Response.json({status:'completed',usage:{input_tokens:100,output_tokens:30},output:[{type:'message',content:[{type:'output_text',text:JSON.stringify(response)}]}]},{status:responseStatus});}};
  return {options,provider:createVisionProvider(options),calls,reservations,completed};
}
test('Prepared vision connection carries verified image bytes, quotes scoped context and grants no tools or agreement writes',async()=>{
  const s=setup();assert.deepEqual(await s.provider.respond(input),output);
  assert.equal(s.calls.length,2);const request=s.calls[1].body;
  assert.deepEqual(request.tools,[]);assert.equal(request.store,false);assert.equal(request.max_output_tokens,1200);
  assert.match(request.input[0].content[1].image_url,/^data:image\/png;base64,/);
  assert.equal(JSON.stringify(request).includes('Do not disclose unrelated context'),false);
  assert.equal(request.text.format.schema.additionalProperties,false);
  assert.equal(s.reservations[0].ceilingCadMicros,2500);
  assert.equal(s.completed.length,1);
});
test('Disabled, unapproved, expired pricing or unverified discussion permissions send no provider data',async()=>{
  const s=setup();await assert.rejects(createVisionProvider({...s.options,approved:false}).respond(input),/disabled/);
  await assert.rejects(s.provider.respond({...input,permission:null}),/permission/);
  await assert.rejects(createVisionProvider({...s.options,pricing:{...s.options.pricing,validUntil:'2020-01-01T00:00:00Z'}}).respond(input),/pricing/);
  await assert.rejects(s.provider.respond({...input,images:[{...input.images[0],mime:'image/heic'}]}),/JPEG or PNG/);
  assert.equal(s.calls.length,0);
});
test('Input limits and persistent budget refusal stop before generation; completed reservations replay without another generation',async()=>{
  const large=setup({inputTokens:20000});await assert.rejects(large.provider.respond(input),/token allowance/);assert.equal(large.calls.length,1);assert.equal(large.reservations.length,0);
  const capped=setup({denyBudget:true});await assert.rejects(capped.provider.respond(input),/Allowance/);assert.equal(capped.calls.length,1);
  const replay=setup({replayed:true});assert.deepEqual(await replay.provider.respond(input),output);assert.equal(replay.calls.length,1);assert.equal(replay.completed.length,0);
});
test('Generation errors and forged agreement actions do not trigger paid retries or complete a reservation',async()=>{
  const failure=setup({responseStatus:503});await assert.rejects(failure.provider.respond(input),/reserved allowance/);assert.equal(failure.calls.length,2);assert.equal(failure.completed.length,0);
  const forged=setup({response:{...output,lock_agreement:true}});await assert.rejects(forged.provider.respond(input),/validation/);assert.equal(forged.completed.length,0);
});
