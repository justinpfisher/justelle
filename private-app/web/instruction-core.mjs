// Strict, provider-neutral member instruction interpreter.
// This is bounded deterministic text support, NOT a claim of AI extraction.
import {applyItineraryEdit,itinerarySignals} from './itinerary-core.mjs';
const format='justelle-member-instruction-v1';
const ready=(change,summary,preview=false,extra={})=>({
  format,kind:'ready',change,summary,preview_required:preview,
  source_kind:'member_text',confidence:'exact_grammar',...extra
});
const clarify=(message)=>({format,kind:'needs_detail',message,change:null});
const decline=(message)=>({format,kind:'unsupported',message,change:null});
const asNumber=s=>Number(s);
const findStop=(plan,title)=>{
  const matched=plan.stops.filter(s=>s.title.toLocaleLowerCase('en-CA')===title.trim().toLocaleLowerCase('en-CA'));
  return matched.length===1?matched[0]:null;
};
export function interpretPlanInstruction(plan,input,{idFactory=()=>crypto.randomUUID()}={}){
  const text=typeof input==='string'?input.trim():'';
  if(!text||text.length>300)return decline('Use a short instruction of up to 300 characters.');
  if(/^(book|reserve|confirm|cancel booking)\b/i.test(text))
    return decline('Supplier reservations are external. Record a source confirmation separately.');
  let match,change,summary;
  if(match=/^(add|plan|consider|maybe)\s+(\d{1,2})\s+nights?\s+in\s+(.+?)\s+(?:starting|from)\s+day\s+(\d{1,2})[.!]?$/i.exec(text)){
    const [,verb,num,rawPlace,rawDay]=match,nights=asNumber(num),from=asNumber(rawDay),title=rawPlace.trim();
    if(!nights||!from||title.length>160)return clarify('Check the number of nights, place and starting day.');
    if(plan.stops.some(s=>s.title.toLocaleLowerCase('en-CA')===title.toLocaleLowerCase('en-CA')))
      return clarify('That place already exists. Use its current entry or specify a different place.');
    const status=/^(consider|maybe)$/i.test(verb)?'possible':'planned';
    change={type:'add_stop',stop:{id:idFactory(),place_id:idFactory(),
      title,from_day:from,through_day:from+nights,status}};
    summary=(status==='possible'?'Consider ':'Plan ')+nights+' nights in '+title+', starting day '+from+'. This does not book accommodation.';
  }else if(match=/^move\s+(.+?)\s+to\s+day\s+(\d{1,2})[.!]?$/i.exec(text)){
    const old=findStop(plan,match[1]),from=asNumber(match[2]);
    if(!old||!from)return clarify('Which saved place should move, and to what day?');
    change={type:'edit_stop',id:old.id,patch:{from_day:from,through_day:from+old.through_day-old.from_day}};
    summary='Move '+old.title+' to day '+from+' without changing any supplier booking.';
  }else if(match=/^mark\s+(.+?)\s+as\s+(possible|planned)[.!]?$/i.exec(text)){
    const old=findStop(plan,match[1]),status=match[2].toLowerCase();
    if(!old)return clarify('Which existing place should change status?');
    change={type:'edit_stop',id:old.id,patch:{status}};
    summary='Mark '+old.title+' as '+status+'. This is not a booking confirmation.';
  }else if(match=/^change\s+trip\s+start\s+to\s+(\d{4}-\d{2}-\d{2})[.!]?$/i.exec(text)){
    change={type:'edit_trip',patch:{starts_on:match[1]}};
    summary='Move the intended adventure start to '+match[1]+'. Actual booking dates remain unchanged.';
  }else return clarify('Try “Consider 2 nights in Kyoto starting day 4” or “Move Kyoto to day 6”.');
  let changed;
  try{changed=applyItineraryEdit(plan,change,{eventId:idFactory(),actorId:'instruction-preview',
    at:'2026-10-17T12:00:00.000Z'}).plan;}
  catch(e){return clarify(e.message);}
  const oldSignals=itinerarySignals(plan),newSignals=itinerarySignals(changed);
  const introduced=newSignals.filter(s=>!oldSignals.some(o=>JSON.stringify(o)===JSON.stringify(s)));
  return ready(change,summary,introduced.length>0||change.type==='edit_trip'&&plan.bookings.some(b=>b.status==='confirmed'),
    {introduced_signals:introduced});
}
