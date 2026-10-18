// Strict, provider-free plan/source/history verification before exporting,
// restoring or trusting an archive. No Firebase UIDs are durable identifiers.
import {itineraryDays} from './itinerary-core.mjs';
const uuid=/^[a-f0-9-]{36}$/;
function eq(a,b){
  const canonical=v=>JSON.stringify(v,(_,value)=>value&&typeof value==='object'&&!Array.isArray(value)?
    Object.fromEntries(Object.keys(value).sort().map(k=>[k,value[k]])):value);
  return canonical(a)===canonical(b);
}
const fail=s=>{throw Error('Plan recovery integrity: '+s);};
const linked=(id,set,label)=>{if(id!=null&&!set.has(id))fail('Broken '+label+' relationship');};
function untouchedExcept(before,after,collection){
  if(!before||!after)return false;
  const fields=['stops','experiences','bookings','lessons','status'];
  if(fields.some(field=>field!==collection&&!eq(
    field==='experiences'?(before[field]??[]):before[field],
    field==='experiences'?(after[field]??[]):after[field])))return false;
  return collection==='trip'||(before.title===after.title &&
    before.starts_on===after.starts_on && before.duration_days===after.duration_days);
}
const operations={
  add_stop:'stops',edit_stop:'stops',remove_stop:'stops',
  add_booking:'bookings',correct_booking:'bookings',add_lesson:'lessons',
  add_experience:'experiences',edit_experience:'experiences',remove_experience:'experiences',
  edit_trip:'trip',set_status:'status'
};
function value(state,collection,id){
  if(state==null)return null;
  if(['stops','experiences','bookings','lessons'].includes(collection))
    return (state[collection]??[]).find(x=>x.id===id)||null;
  if(collection==='status')return state.status;
  if(collection==='trip')return {title:state.title,starts_on:state.starts_on,duration_days:state.duration_days};
  fail('Unknown event collection');
}
export function validatePortablePlannerRecords(records){
  const plans=records.adventure_plans||[],events=records.plan_events||[],
    sources=records.plan_sources||[],documents=records.plan_documents||[];
  if(![plans,events,sources,documents].every(Array.isArray))fail('Invalid planner collection');
  if(!plans.length&&(events.length||sources.length||documents.length))fail('Orphan planner records');
  const ids=new Set(plans.map(p=>p.id)),members=new Set(records.persons.map(p=>p.id));
  const sourcesById=new Map(sources.map(s=>[s.id,s]));
  const docsById=new Map(documents.map(d=>[d.id,d]));
  for(const d of documents){
    linked(d.adventure_id,ids,'document adventure');
    linked(d.author_id,members,'document author');
    if(!uuid.test(d.id)||d.storage_path!=='documents/'+d.id||
       !['application/pdf','image/png','image/jpeg','image/heic','image/heif'].includes(d.mime)||
       !Number.isInteger(d.size)||d.size<1||d.size>12582912||
       !/^[a-f0-9]{64}$/.test(d.sha256))fail('Invalid original document descriptor');
  }
  for(const s of sources){
    linked(s.adventure_id,ids,'source adventure');linked(s.author_id,members,'source author');
    linked(s.document_id,docsById.size?new Set(docsById.keys()):new Set(),'source document');
    if(s.document_id&&docsById.get(s.document_id).adventure_id!==s.adventure_id)
      fail('Source document belongs to another adventure');
    if(!['booking','note','research'].includes(s.kind))fail('Invalid source type');
  }
  const seen=new Set();
  for(const p of plans){
    const state=p.state;
    if(!state||state.schema!=='justelle-itinerary-v1'||state.id!==p.id||
       !Number.isSafeInteger(state.revision)||state.revision<0||
       typeof state.last_event_id!=='string'||!state.last_event_id||
       !Array.isArray(state.stops)||!Array.isArray(state.bookings)||!Array.isArray(state.lessons)||
       (state.experiences!==undefined&&!Array.isArray(state.experiences)))
      fail('Invalid saved adventure state');
    linked(p.author_id,members,'planner author');
    linked(p.last_modified_by,members,'planner editor');
    // The day projection validates trip bounds without deriving local dates
    // from time-zone-sensitive midnight conversions.
    try{itineraryDays(state);}catch{fail('Invalid itinerary dates or duration');}
    for(const kind of ['stops','experiences','bookings','lessons']){
      const rows=state[kind]??[];if(new Set(rows.map(x=>x.id)).size!==rows.length)
        fail('Duplicate '+kind+' stable ID');
    }
    for(const s of state.stops)if(!['possible','planned'].includes(s.status)||
      !Number.isInteger(s.from_day)||!Number.isInteger(s.through_day)||
      s.from_day<1||s.through_day<=s.from_day||s.through_day>state.duration_days+1)
      fail('Invalid stay/nights or possible/planned state');
    for(const e of state.experiences??[]){
      if(typeof e.title!=='string'||!e.title.trim()||e.title.length>200||
         !Number.isInteger(e.day)||e.day<1||e.day>state.duration_days||
         !['possible','planned'].includes(e.status)||
         typeof e.notes!=='string'||e.notes.length>1000)
        fail('Invalid day experience');
    }
    for(const b of state.bookings){
      if(!['stay','flight','transport','activity'].includes(b.kind)||
         !['unverified','confirmed','cancelled','voided'].includes(b.status)||
         typeof b.starts_on!=='string'||typeof b.ends_on!=='string')
        fail('Invalid booking anchor');
      if(b.source_id){
        const s=sourcesById.get(b.source_id);
        if(!s||s.adventure_id!==p.id)fail('Broken booking source relationship');
      }
      if(b.status==='confirmed'&&(!b.source_id||sourcesById.get(b.source_id)?.kind!=='booking'))
        fail('Confirmed booking lacks separate original');
    }
    const chain=events.filter(e=>e.adventure_id===p.id).sort((a,b)=>a.revision-b.revision);
    if(chain.length!==state.revision+1)fail('Missing or duplicate plan revision');
    let previous=null;
    for(let index=0;index<chain.length;index++){
      const e=chain[index];seen.add(e.id);
      if((e.instruction_text!==undefined || e.instruction_format!==undefined) &&
         (typeof e.instruction_text!=='string'||!e.instruction_text.trim()||
          e.instruction_text.length>300||
          e.instruction_format!=='justelle-member-instruction-v1'))
        fail('Invalid original member instruction provenance');
      if(e.revision!==index||e.previous_event_id!==(previous?.id||null)||
         e.after_state?.revision!==index||e.after_state?.last_event_id!==e.id||
         !eq(e.before_state,previous?.after_state||null)||
         e.author_id!==e.actor_id||!members.has(e.author_id)||
         typeof e.created_at!=='string'||!Number.isFinite(Date.parse(e.created_at))||
         e.at!==e.created_at)
        fail('Broken immutable plan event chain');
      if(index===0){
        if(e.operation!=='create_trip'||e.before!==null||e.before_state!==null||
          e.collection!=='trip'||e.record_id!==p.id||!eq(e.after,e.after_state))
          fail('Invalid adventure creation event');
      }else{
        if(e.operation==='create_trip'||
           (e.operation==='undo_last'?!['stops','experiences','bookings','lessons','status','trip'].includes(e.collection):
              operations[e.operation]!==e.collection)||
           !untouchedExcept(e.before_state,e.after_state,e.collection)||
           !eq(e.before,value(e.before_state,e.collection,e.record_id))||
           !eq(e.after,value(e.after_state,e.collection,e.record_id)))
          fail('Event before/after does not match actual revision');
      }
      previous=e;
    }
    if(!eq(previous?.after_state,state)||previous?.id!==state.last_event_id)
      fail('Current plan differs from immutable event history');
  }
  if(seen.size!==events.length)fail('Unreferenced plan event');
  return {adventure_plans:plans.length,plan_events:events.length,
    plan_sources:sources.length,plan_documents:documents.length};
}
