import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createItinerary,applyItineraryEdit} from '../web/itinerary-core.mjs';
import {validatePlanSuggestion} from '../web/plan-suggestion-core.mjs';
const plan=()=>createItinerary({id:'fictional',title:'Fictional journey',durationDays:6,startsOn:'2026-11-01'});
const proposal=(overrides={})=>({
  kind:'suggestion',operation:'add_stop',title:'Fictional Bay',day:2,nights:2,
  status:'possible',explanation:'The member asked to consider an overnight place.',
  uncertainty:'No booking was checked.',...overrides
});
test('Quarantined model content produces preview-only changes, not a booking or plan write',()=>{
  const original=plan(),untouched=structuredClone(original);
  let n=0;const preview=validatePlanSuggestion(original,proposal(),
    {idFactory:()=>['stop-1','place-1','event-1'][n++]});
  assert.equal(preview.kind,'preview');
  assert.equal(preview.preview_required,true);
  assert.equal(preview.change.type,'add_stop');
  assert.equal(preview.change.stop.status,'possible');
  assert.equal(preview.change.stop.from_day,2);
  assert.equal(preview.change.stop.through_day,4);
  assert.equal(preview.change.stop.id,'stop-1');
  assert.match(preview.booking_message,/No external booking/);
  assert.deepEqual(original,untouched);
  const committed=applyItineraryEdit(original,preview.change,{
    eventId:'member-1',actorId:'person-a',at:'2026-11-01T12:00:00Z'});
  assert.equal(committed.plan.bookings.length,0);
  const undone=applyItineraryEdit(committed.plan,{type:'undo_last'},{
    eventId:'member-2',actorId:'person-b',at:'2026-11-01T12:01:00Z',
    lastEvent:committed.event});
  assert.equal(undone.plan.stops.length,0);
});
test('Structured day experiences cannot silently become tickets or booking confirmations',()=>{
  const p=plan(),preview=validatePlanSuggestion(p,proposal({
    operation:'add_experience',title:'Fictional museum',day:3,nights:0,status:'planned'
  }));
  assert.equal(preview.change.type,'add_experience');
  assert.equal(preview.change.experience.day,3);
  assert.deepEqual(p.bookings,[]);
  for(const data of [
    proposal({operation:'add_booking'}),proposal({operation:'remove_stop'}),
    proposal({nights:100}),proposal({day:7}),proposal({title:''}),
    proposal({status:'confirmed'}),proposal({source_id:'forged'}),
    proposal({day:1.5}),proposal({operation:'add_experience',nights:1})
  ])assert.throws(()=>validatePlanSuggestion(p,data));
});
test('Conflicts and duplicate destinations remain visible before human Apply',()=>{
  const state=applyItineraryEdit(plan(),{type:'add_stop',stop:{
    id:'home',place_id:'home',title:'Fictional Home',status:'planned',
    from_day:1,through_day:4
  }},{eventId:'first',actorId:'member-a',at:'2026-11-01T10:00:00Z'}).plan;
  assert.equal(validatePlanSuggestion(state,proposal({status:'planned'})).signals[0].code,
    'overlapping_planned_stays');
  assert.throws(()=>validatePlanSuggestion(state,proposal({title:'Fictional Home'})),
    /duplicates/);
});
test('Ambiguous screenshot yields clarification, never speculative itinerary data',()=>{
  const result=validatePlanSuggestion(plan(),proposal({kind:'needs_detail',
    operation:'none',title:'',day:0,nights:0,
    explanation:'The screenshot does not specify a destination or date.'}));
  assert.equal(result.kind,'needs_detail');
  assert.equal(Object.hasOwn(result,'change'),false);
  assert.throws(()=>validatePlanSuggestion(plan(),proposal({kind:'needs_detail'})));
});
