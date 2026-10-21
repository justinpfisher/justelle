import {test} from 'node:test';import assert from 'node:assert/strict';
import {createItinerary,applyItineraryEdit} from '../web/itinerary-core.mjs';
import {interpretPlanInstruction} from '../web/instruction-core.mjs';
const base=()=>createItinerary({id:'fictional',title:'Synthetic trip',durationDays:12,startsOn:'2026-10-29'});
function added(p,change){return applyItineraryEdit(p,change,{eventId:'original',
 actorId:'person-a',at:'2026-10-17T00:00:00Z'}).plan;}
test('Clear member instruction produces only a reversible intended stop, never a reservation',()=>{
 const p=base();const i=interpretPlanInstruction(p,'Consider 3 nights in Kyoto starting day 5');
 assert.equal(i.kind,'ready');assert.equal(i.change.type,'add_stop');
 assert.equal(i.change.stop.status,'possible');assert.equal(i.change.stop.through_day,8);
 assert.equal(i.preview_required,false);assert.deepEqual(p.bookings,[]);
 assert.match(i.summary,/does not book accommodation/);
});
test('Move existing stop preserves its night count, warns on conflicts and never shifts booking dates',()=>{
 let p=added(base(),{type:'add_stop',stop:{id:'town',place_id:'town',title:'Kyoto',
  from_day:2,through_day:5,status:'planned'}});
 const i=interpretPlanInstruction(p,'Move Kyoto to day 7');
 assert.equal(i.kind,'ready');assert.deepEqual(i.change.patch,{from_day:7,through_day:10});
 assert.equal(p.stops[0].from_day,2);
 assert.equal(interpretPlanInstruction(p,'Move Unknown to day 7').kind,'needs_detail');
});
test('Impossible or ambiguous instructions fail without writes or invented confirmations',()=>{
 const p=base();
 for(const t of ['Book our hotel for tomorrow','Confirm the flight',
  'Consider 90 nights in Kyoto starting day 9','Move Kyoto to day 8',
  'Add three nights in Paris',''])assert.notEqual(interpretPlanInstruction(p,t).kind,'ready');
 assert.equal(p.revision,0);
});
test('Date shifts with recorded confirmations require preview, not silent external rebooking',()=>{
 let p=added(base(),{type:'add_booking',booking:{id:'hotel',kind:'stay',stop_id:null,
  starts_on:'2026-10-29',ends_on:'2026-11-01',status:'confirmed',source_id:'original-source',summary:'Fictional hotel'}});
 const i=interpretPlanInstruction(p,'Change trip start to 2026-11-05');
 assert.equal(i.kind,'ready');assert.equal(i.preview_required,true);
 assert.equal(p.bookings[0].starts_on,'2026-10-29');
 assert.ok(i.introduced_signals.some(s=>s.code==='booking_outside_trip'));
});

test('Unambiguous day-experience instruction makes a reversible plan item, never a booking',()=>{
 const p=base();
 const instruction=interpretPlanInstruction(p,'Consider a visit to the fictional botanic garden on day 5',
   {idFactory:()=> 'synthetic-experience'});
 assert.equal(instruction.kind,'ready');
 assert.equal(instruction.change.type,'add_experience');
 assert.deepEqual(instruction.change.experience,{
   id:'synthetic-experience',title:'the fictional botanic garden',day:5,status:'possible',notes:''});
 assert.equal(instruction.preview_required,false);
 assert.equal(instruction.source_kind,'member_text');
 assert.match(instruction.summary,/does not book tickets/);
 const created=applyItineraryEdit(p,instruction.change,{
   eventId:'event-one',actorId:'person-a',at:'2026-10-19T12:00:00Z'});
 assert.equal(created.plan.experiences[0].day,5);
 assert.equal(created.plan.bookings.length,0);
 const undone=applyItineraryEdit(created.plan,{type:'undo_last'},{
   eventId:'event-two',actorId:'person-b',at:'2026-10-19T12:01:00Z',
   lastEvent:created.event});
 assert.equal(undone.plan.experiences.length,0);
 assert.equal(undone.plan.revision,2);
 assert.equal(undone.event.operation,'undo_last');
});
test('Day experience language is conservative about duplicates, invalid spans and confirmations',()=>{
 const p=base();
 const planned=interpretPlanInstruction(p,'Plan visiting a fictional aquarium on day 2',
   {idFactory:()=> 'experience-id'});
 assert.equal(planned.change.experience.status,'planned');
 const existing=added(p,{type:'add_experience',experience:{
   id:'experience-id',title:'a fictional aquarium',day:2,status:'planned',notes:''
 }});
 assert.equal(interpretPlanInstruction(existing,'Plan visiting a fictional aquarium on day 2').kind,'needs_detail');
 assert.equal(interpretPlanInstruction(p,'Plan a visit to the fictional aquarium on day 99').kind,'needs_detail');
 assert.equal(interpretPlanInstruction(p,'Reserve tickets to the fictional aquarium for day 2').kind,'unsupported');
 assert.deepEqual(p.experiences,[]);
});

test('Clear approximate-month instructions preserve uncertainty, prior date and Undo',()=>{
 const original=base();
 for(const phrase of ['Change trip start to December 2027',
   'Change trip start to 2027-12']){
   const outcome=interpretPlanInstruction(original,phrase);
   assert.equal(outcome.kind,'ready');
   assert.deepEqual(outcome.change,{type:'edit_trip',patch:{starts_month:'2027-12'}});
   assert.equal(outcome.preview_required,false);
   assert.match(outcome.summary,/without choosing a day/);
   const first=applyItineraryEdit(original,outcome.change,{
     eventId:'approximate-date',actorId:'person-a',at:'2026-10-21T10:00:00Z'});
   assert.equal(first.plan.starts_month,'2027-12');
   assert.equal(first.plan.starts_on,null);
   const undone=applyItineraryEdit(first.plan,{type:'undo_last'},{
     eventId:'undo-date',actorId:'person-b',at:'2026-10-21T10:01:00Z',lastEvent:first.event});
   assert.equal(undone.plan.starts_on,'2026-10-29');
   assert.equal(undone.plan.starts_month,null);
   assert.equal(original.starts_on,'2026-10-29');
 }
 for(const phrase of ['Change trip start to 2027-13','Change trip start to 12/2027',
   'Change trip start to Winter 2027','Change trip start to December',
   'Change trip start to December 1899']){
   const outcome=interpretPlanInstruction(original,phrase);
   assert.notEqual(outcome.kind,'ready',phrase);
 }
});
test('Month-only change with an existing booking requires preview and never rebooks',()=>{
 const p=added(base(),{type:'add_booking',booking:{id:'booking-anchored',kind:'stay',
   stop_id:null,starts_on:'2026-10-29',ends_on:'2026-11-02',
   status:'confirmed',source_id:'fictional-original',summary:'Synthetic hotel booking'}});
 const outcome=interpretPlanInstruction(p,'Change trip start to December 2027');
 assert.equal(outcome.kind,'ready');
 assert.equal(outcome.preview_required,true);
 assert.deepEqual(outcome.change.patch,{starts_month:'2027-12'});
 assert.equal(p.bookings[0].starts_on,'2026-10-29');
 const updated=applyItineraryEdit(p,outcome.change,{
   eventId:'month-shift',actorId:'person-a',at:'2026-10-21T10:00:00Z'});
 assert.equal(updated.plan.starts_on,null);
 assert.equal(updated.plan.starts_month,'2027-12');
 assert.equal(updated.plan.bookings[0].starts_on,p.bookings[0].starts_on);
});
