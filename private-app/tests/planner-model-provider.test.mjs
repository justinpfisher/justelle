import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createPlannerModelProvider} from '../ai/planner-model-provider.mjs';
import {createItinerary} from '../web/itinerary-core.mjs';
const result={kind:'suggestion',operation:'add_experience',title:'Fictional gallery',day:3,
  nights:0,status:'possible',explanation:'The note mentions a gallery.',
  uncertainty:'Times and ticket availability are not verified.'};
const plan=()=>createItinerary({id:'fictional',title:'Synthetic voyage',durationDays:7});
function setup({denyBudget=false,replayed=false,output=result}={}){
  const calls=[],receipts=[],completed=[];
  const budget={async reserve(r){receipts.push(r);if(denyBudget)throw Error('Budget exhausted');
    return {replayed,result:output};},async complete(r){completed.push(r);}};
  const provider=createPlannerModelProvider({approved:true,model:'fictional-model',
    apiKey:'fictional-key',pricing:{model:'fictional-model',
      inputCadMicrosPerMillion:1000000,outputCadMicrosPerMillion:2000000,
      validUntil:'2099-01-01'},budget,
    async fetchImpl(url,options){
      calls.push({url,body:JSON.parse(options.body)});
      if(url.endsWith('/input_tokens'))return Response.json({input_tokens:100});
      return Response.json({status:'completed',usage:{input_tokens:100,output_tokens:60},
        output:[{type:'message',content:[{type:'output_text',text:JSON.stringify(output)}]}]});
    }});
  return {provider,calls,receipts,completed};
}
const input=()=>({roomId:'fictional-room',permission:{roomId:'fictional-room',personId:'person-a'},
  sourceId:'source-id',plan:plan(),text:'Consider a gallery on day 3',
  images:[{mime:'image/png',bytes:Uint8Array.from([1,2,3])}]});
test('Protected provider uses bounded schema, scoped plan and verified screenshot without tools',async()=>{
 const s=setup();assert.deepEqual(await s.provider.suggest(input()),result);
 assert.equal(s.calls.length,2);
 const request=s.calls[1].body;
 assert.equal(request.store,false);assert.deepEqual(request.tools,[]);
 assert.equal(request.text.format.strict,true);
 assert.equal(request.text.format.schema.additionalProperties,false);
 assert.equal(request.max_output_tokens,1200);
 assert.match(request.input[0].content[1].image_url,/^data:image\/png;base64,/);
 assert.equal(s.receipts[0].ceilingCadMicros,2500);
 assert.equal(s.completed.length,1);
 assert.equal(JSON.stringify(request).includes('booking reference'),false);
});
test('Denied budget and replay never initiate a second generation',async()=>{
 const stopped=setup({denyBudget:true});
 await assert.rejects(stopped.provider.suggest(input()),/Budget exhausted/);
 assert.equal(stopped.calls.length,1);
 const replay=setup({replayed:true});
 assert.deepEqual(await replay.provider.suggest(input()),result);
 assert.equal(replay.calls.length,1);assert.equal(replay.completed.length,0);
});
test('No model calls for forged permissions, oversized text, unsupported images or missing input',async()=>{
 const s=setup();
 for(const change of [
   {permission:{roomId:'other-room',personId:'person-a'}},
   {text:'x'.repeat(301)},
   {images:[{mime:'image/heic',bytes:Uint8Array.from([1,2])}]},
   {text:'',images:[]}
 ])await assert.rejects(s.provider.suggest({...input(),...change}));
 assert.equal(s.calls.length,0);
});
test('Model output cannot inject booking fields or unrestricted actions',async()=>{
 const s=setup({output:{...result,operation:'correct_booking',source_id:'forged'}});
 await assert.rejects(s.provider.suggest(input()),/validation/);
 assert.equal(s.completed.length,0);
});
