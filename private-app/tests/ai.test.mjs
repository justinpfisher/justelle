import {test} from 'node:test';
import assert from 'node:assert/strict';
import {chooseProvider} from '../ai/adapter.mjs';

test('Demo AI does not fabricate answers or file ordinary questions as plans',async()=>{
  const ai=chooseProvider();
  const reply=await ai.respond({message:{body:'How many apples grow on an apple tree?'},
    context:{messages:[{body:'We were talking about apples'}]},images:[]});
  assert.match(reply.reply,/cannot|can’t answer factual questions/i);
  assert.equal(reply.proposal,null);
  assert.doesNotMatch(reply.reply,/No decision has been made|I can help explore this idea/i);
});
test('Demo AI receives images but does not pretend to understand what they show',async()=>{
  const reply=await chooseProvider().respond({message:{body:'What is in this synthetic photo?'},
    images:[{mime:'image/png',bytes:new Uint8Array([1,2,3])}],context:{}});
  assert.match(reply.reply,/cannot interpret what the images show/);
  assert.equal(reply.proposal,null);
});
test('Only an explicitly requested plan produces a pending test suggestion',async()=>{
  const ai=chooseProvider();
  const ask=await ai.respond({message:{body:'Please suggest a plan for a fictional museum visit.'},images:[],context:{}});
  assert.ok(ask.proposal);
  assert.match(ask.proposal.why,/if you both agree/);
  const casual=await ai.respond({message:{body:'Could we plan a fictional museum visit?'},images:[],context:{}});
  assert.equal(casual.proposal,null);
  assert.throws(()=>chooseProvider('paid-model'),/No paid AI provider/);
});
