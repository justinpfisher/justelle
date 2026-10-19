// Shared bounded model call for discussion replies and planner previews.
// No model tools, automatic retries, database credentials or uncapped spending.
import {createHash} from 'node:crypto';
export const fingerprint=value=>createHash('sha256').update(JSON.stringify(value)).digest('hex');
async function limitedJSON(response,limit=128*1024){
  const reader=response.body.getReader(),parts=[];let size=0;
  try{
    while(true){const {done,value}=await reader.read();if(done)break;
      size+=value.length;if(size>limit)throw Error('AI response too large');
      parts.push(Buffer.from(value));
    }
  }finally{await reader.cancel();}
  return JSON.parse(Buffer.concat(parts));
}
export async function generateStrictResponse({request,requestId,validate,approved,apiKey,model,pricing,budget,
  fetchImpl=fetch,maxInputTokens=16000,maxOutputTokens=1200,now=()=>new Date()}){
  if(!approved||!apiKey||!budget)throw Error('Paid AI is disabled until account and budget approval');
  if(!/^[a-zA-Z0-9][a-zA-Z0-9_.:-]{0,119}$/.test(model||'')||
    !pricing||pricing.model!==model||
    !Number.isSafeInteger(pricing.inputCadMicrosPerMillion)||pricing.inputCadMicrosPerMillion<=0||
    !Number.isSafeInteger(pricing.outputCadMicrosPerMillion)||pricing.outputCadMicrosPerMillion<=0||
    Number.isNaN(Date.parse(pricing.validUntil))||new Date(pricing.validUntil)<=now())
    throw Error('Current approved model pricing in CAD is required');
  if(!Number.isSafeInteger(maxInputTokens)||maxInputTokens<=0||maxInputTokens>100000||
    !Number.isSafeInteger(maxOutputTokens)||maxOutputTokens<=0||maxOutputTokens>4000)
    throw Error('Invalid AI token limits');
  if(request.model!==model||request.store!==false||request.tools?.length!==0||
    request.max_output_tokens!==maxOutputTokens||typeof validate!=='function')
    throw Error('Invalid bounded model request');
  const id=fingerprint(requestId),proof=fingerprint(request);
  const headers={'Authorization':'Bearer '+apiKey,'Content-Type':'application/json'};
  const countPayload={model,input:request.input,instructions:request.instructions,
    tools:[],text:request.text};
  const countResponse=await fetchImpl('https://api.openai.com/v1/responses/input_tokens',{
    method:'POST',headers,redirect:'error',signal:AbortSignal.timeout(20000),
    body:JSON.stringify(countPayload)});
  if(!countResponse.ok)throw Error('AI input qualification failed; no generation was started');
  const count=await limitedJSON(countResponse);
  if(!Number.isSafeInteger(count.input_tokens)||count.input_tokens<1||
    count.input_tokens>maxInputTokens)throw Error('AI input exceeds its token allowance');
  const ceiling=(BigInt(count.input_tokens)*BigInt(pricing.inputCadMicrosPerMillion)+
    BigInt(maxOutputTokens)*BigInt(pricing.outputCadMicrosPerMillion)+999999n)/1000000n;
  if(ceiling>BigInt(Number.MAX_SAFE_INTEGER))throw Error('AI cost reservation exceeds safe accounting limits');
  const ceilingCadMicros=Number(ceiling);
  if(!Number.isSafeInteger(ceilingCadMicros)||ceilingCadMicros<1)
    throw Error('Invalid AI cost reservation');
  const reservation=await budget.reserve({id,fingerprint:proof,ceilingCadMicros,now:now()});
  if(reservation.replayed)return validate(reservation.result);
  const response=await fetchImpl('https://api.openai.com/v1/responses',{
    method:'POST',headers,redirect:'error',signal:AbortSignal.timeout(45000),
    body:JSON.stringify(request)});
  if(!response.ok)throw Error('AI did not complete. Its reserved allowance is retained until recovery.');
  const data=await limitedJSON(response);
  if(data.status!=='completed'||!Number.isSafeInteger(data.usage?.input_tokens)||
    data.usage.input_tokens<0||data.usage.input_tokens>count.input_tokens||
    !Number.isSafeInteger(data.usage?.output_tokens)||data.usage.output_tokens<0||
    data.usage.output_tokens>maxOutputTokens)throw Error('AI completion or usage could not be verified');
  const output=(data.output||[]).filter(x=>x.type==='message').flatMap(x=>x.content||[]);
  if(output.some(x=>x.type==='refusal')||output.filter(x=>x.type==='output_text').length!==1)
    throw Error('AI could not provide a usable reply');
  const result=validate(JSON.parse(output.find(x=>x.type==='output_text').text));
  await budget.complete({id,result});
  return result;
}
