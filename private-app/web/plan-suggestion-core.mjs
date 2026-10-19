// Provider-independent quarantine: a model can suggest only bounded, reversible
// unbooked itinerary additions. It cannot change bookings, remove history or commit.
import {applyItineraryEdit,itinerarySignals} from './itinerary-core.mjs';
const exact=(value,keys)=>value&&typeof value==='object'&&!Array.isArray(value)&&
  Object.keys(value).sort().join(',')===keys.slice().sort().join(',');
const short=(value,max)=>typeof value==='string'&&value.length<=max;
export function validatePlanSuggestion(plan,candidate,{idFactory=()=>crypto.randomUUID()}={}){
  const fields=['kind','operation','title','day','nights','status','explanation','uncertainty'];
  if(!exact(candidate,fields)||!short(candidate.explanation,500)||
    !short(candidate.uncertainty,500)||!short(candidate.title,160)||
    !Number.isSafeInteger(candidate.day)||!Number.isSafeInteger(candidate.nights)||
    !['possible','planned'].includes(candidate.status))throw Error('Untrusted AI planner output');
  if(candidate.kind==='needs_detail'){
    if(candidate.operation!=='none'||!candidate.explanation.trim())throw Error('Invalid clarification');
    return {kind:'needs_detail',message:candidate.explanation,uncertainty:candidate.uncertainty};
  }
  if(candidate.kind!=='suggestion'||!['add_stop','add_experience'].includes(candidate.operation)||
    !candidate.title.trim()||candidate.day<1||candidate.day>plan.duration_days)
    throw Error('AI proposal cannot be safely applied');
  if(candidate.operation==='add_stop'&&
    (candidate.nights<1||candidate.day+candidate.nights>plan.duration_days+1))
    throw Error('AI stay extends outside this adventure');
  if(candidate.operation==='add_experience'&&candidate.nights!==0)
    throw Error('An activity cannot invent booked nights');
  if(candidate.operation==='add_stop'&&plan.stops.some(s=>
    s.title.toLocaleLowerCase('en-CA')===candidate.title.trim().toLocaleLowerCase('en-CA')))
    throw Error('AI location duplicates an existing stop');
  if(candidate.operation==='add_experience'&&(plan.experiences??[]).some(e=>
    e.day===candidate.day&&e.title.toLocaleLowerCase('en-CA')===
      candidate.title.trim().toLocaleLowerCase('en-CA')))
    throw Error('AI experience duplicates an existing entry');
  const change=candidate.operation==='add_stop'?{
    type:'add_stop',stop:{id:idFactory(),place_id:idFactory(),title:candidate.title.trim(),
      from_day:candidate.day,through_day:candidate.day+candidate.nights,status:candidate.status}
  }:{type:'add_experience',experience:{id:idFactory(),title:candidate.title.trim(),
    day:candidate.day,status:candidate.status,notes:''}};
  const next=applyItineraryEdit(plan,change,{eventId:idFactory(),
    actorId:'preview-only',at:'2026-01-01T00:00:00.000Z'}).plan;
  const old=itinerarySignals(plan),signals=itinerarySignals(next).filter(signal=>
    !old.some(previous=>JSON.stringify(previous)===JSON.stringify(signal)));
  const summary=candidate.operation==='add_stop'?
    (candidate.status==='possible'?'Consider ':'Plan ')+candidate.nights+
      ' nights in '+candidate.title.trim()+' from day '+candidate.day:
    (candidate.status==='possible'?'Consider ':'Plan ')+candidate.title.trim()+
      ' on day '+candidate.day;
  return {kind:'preview',change,summary,uncertainty:candidate.uncertainty,
    explanation:candidate.explanation,signals,preview_required:true,
    booking_message:'No external booking, ticket or supplier reservation will change.'};
}
