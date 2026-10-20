import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createItinerary,applyItineraryEdit,itineraryDays,itinerarySignals,sortAdventurePlans} from '../web/itinerary-core.mjs';
const make = (args={}) => createItinerary({id:'fictional-trip',title:'Amber Coast',durationDays:21,...args});
const edit = (plan,change,eventId,lastEvent=null) => applyItineraryEdit(plan,change,{eventId,actorId:'member-a',at:'2026-10-17T14:00:00Z',lastEvent});
const stop = (id='town-a',p={}) => ({id,place_id:id,title:id,from_day:4,through_day:7,status:'possible',...p});
const booking = (p={}) => ({id:'booking-1',kind:'stay',stop_id:'town-a',starts_on:'2026-10-28',ends_on:'2026-10-31',status:'confirmed',summary:'Fictional hotel',source_id:'synthetic-source',...p});

test('blank day canvas respects dates and daylight saving boundaries',()=>{
  const p=make({startsOn:'2026-10-25'}), days=itineraryDays(p);
  assert.equal(days.length,21);
  assert.deepEqual(days.map(d=>d.date).slice(0,2),['2026-10-25','2026-10-26']);
  assert.equal(days.at(-1).date,'2026-11-14');
  assert.ok(days.every(d=>d.stops.length===0&&d.bookings.length===0));
  assert.equal(itineraryDays(make())[0].date,null);
  assert.throws(()=>make({startsOn:'2026-02-30'}),/calendar date/);
});
test('city stays can be moved immediately without mutating an earlier revision',()=>{
  const original=make();
  const {plan:a,event:e1}=edit(original,{type:'add_stop',stop:stop()},'ev1');
  const {plan:b,event:e2}=edit(a,{type:'edit_stop',id:'town-a',patch:{from_day:8,through_day:11,status:'planned'}},'ev2');
  assert.equal(original.stops.length,0);
  assert.equal(a.stops[0].from_day,4);
  assert.equal(b.stops[0].from_day,8);
  assert.equal(b.revision,2);
  assert.equal(e2.previous_event_id,e1.id);
  assert.equal(e2.actor_id,'member-a');
  assert.equal(e2.before.status,'possible');
  assert.equal(e2.after.status,'planned');
  assert.equal(itineraryDays(b)[7].stops[0].id,'town-a');
});
test('bookings remain anchored when a city block moves; never silently rebook',()=>{
  const a=edit(make({startsOn:'2026-10-25'}),{type:'add_stop',stop:stop()},'ev1').plan;
  const b=edit(a,{type:'add_booking',booking:booking()},'ev2').plan;
  const c=edit(b,{type:'edit_stop',id:'town-a',patch:{from_day:9,through_day:12}},'ev3').plan;
  assert.equal(c.bookings[0].starts_on,'2026-10-28');
  assert.deepEqual(itinerarySignals(c),[{code:'booking_plan_mismatch',booking_id:'booking-1',stop_id:'town-a'}]);
  assert.equal(itineraryDays(c)[3].bookings[0].id,'booking-1');
});
test('possible overlaps are allowed but overlapping planned city stays are flagged',()=>{
  let p=edit(make(),{type:'add_stop',stop:stop('a',{status:'planned'})},'ev1').plan;
  p=edit(p,{type:'add_stop',stop:stop('b',{from_day:5,through_day:8})},'ev2').plan;
  assert.deepEqual(itinerarySignals(p),[]);
  p=edit(p,{type:'edit_stop',id:'b',patch:{status:'planned'}},'ev3').plan;
  assert.deepEqual(itinerarySignals(p),[{code:'overlapping_planned_stays',stop_ids:['a','b']}]);
});
test('undo creates another attributable event instead of deleting history',()=>{
  const a=edit(make(),{type:'add_stop',stop:stop()},'ev1');
  const undone=edit(a.plan,{type:'undo_last'},'ev2',a.event);
  assert.equal(undone.plan.stops.length,0);
  assert.equal(undone.event.before.id,'town-a');
  assert.equal(undone.event.after,null);
  assert.equal(undone.event.previous_event_id,'ev1');
  assert.equal(undone.plan.revision,2);
  assert.throws(()=>edit(a.plan,{type:'undo_last'},'ev3',null),/Latest event/);
});
test('removing a city does not erase its booking; review highlights orphan',()=>{
  let p=edit(make({startsOn:'2026-10-25'}),{type:'add_stop',stop:stop()},'ev1').plan;
  p=edit(p,{type:'add_booking',booking:booking()},'ev2').plan;
  p=edit(p,{type:'remove_stop',id:'town-a'},'ev3').plan;
  assert.equal(p.bookings.length,1);
  assert.deepEqual(itinerarySignals(p),[{code:'booking_without_stop',booking_id:'booking-1'}]);
});
test('archiving preserves planning records and adds reusable travel lessons',()=>{
  let p=edit(make(),{type:'add_lesson',id:'lesson1',text:'Allow more time for outdoor activities.'},'ev1').plan;
  const x=edit(p,{type:'set_status',status:'archived'},'ev2');
  assert.equal(x.plan.status,'archived');
  assert.equal(x.plan.lessons[0].text,'Allow more time for outdoor activities.');
  assert.equal(x.event.before,'planning');
});
test('invalid bounds, IDs, coordinates and patch fields fail without changing original',()=>{
  const p=make();
  assert.throws(()=>edit(p,{type:'add_stop',stop:stop('escape',{from_day:21,through_day:24})},'ev1'),/Days exceed/);
  assert.throws(()=>edit(p,{type:'add_stop',stop:stop('escape',{longitude:54})},'ev2'),/map coordinates/);
  assert.throws(()=>edit(p,{type:'add_stop',stop:stop('../bad')},'ev3'),/stable ID/);
  assert.equal(p.revision,0);
  const x=edit(p,{type:'add_stop',stop:stop()},'ev4').plan;
  assert.throws(()=>edit(x,{type:'edit_stop',id:'town-a',patch:{booked:true}},'ev5'),/Invalid stop patch/);
});
test('earliest active or next trip sorts above undated and archived adventures',()=>{
  const plans=[make({id:'archive',startsOn:'2026-09-01'}),make({id:'future',startsOn:'2027-01-10'}),make({id:'undated'}),make({id:'current',startsOn:'2026-10-15'})];
  const archived=edit(plans[0],{type:'set_status',status:'archived'},'archive-ev').plan;
  assert.deepEqual(sortAdventurePlans([archived,...plans.slice(1)],'2026-10-17').map(x=>x.id),['current','future','undated','archive']);
});


test('booking is never silently marked confirmed from missing source status',()=>{
  const p=make();
  assert.throws(()=>edit(p,{type:'add_booking',booking:booking({status:undefined})},'no-status'),/booking kind or status/);
  const x=edit(p,{type:'add_booking',booking:booking({status:'unverified'})},'unverified').plan;
  assert.equal(x.bookings[0].status,'unverified');
  assert.equal(itinerarySignals(x).length,0);
});

test('All bookings reject reversed dates without changing existing plans or sources',()=>{
 const original=make({startsOn:'2026-11-01'});
 const travel=booking({id:'synthetic-travel',kind:'transport',stop_id:null,
   source_id:null,status:'unverified',starts_on:'2026-11-09',ends_on:'2026-11-08'});
 assert.throws(()=>edit(original,{type:'add_booking',booking:travel},'invalid-transport'),
   /Invalid booking calendar dates/);
 const valid=edit(original,{type:'add_booking',
   booking:{...travel,ends_on:'2026-11-09'}},'valid-day');
 assert.throws(()=>edit(valid.plan,{type:'correct_booking',id:'synthetic-travel',
   patch:{ends_on:'2026-11-07'}},'invalid-correction'),/Invalid booking calendar dates/);
 assert.equal(original.bookings.length,0);
 assert.equal(valid.plan.bookings[0].ends_on,'2026-11-09');
 assert.deepEqual(valid.plan.bookings[0].source_id,null);
});

test('trip date changes move tentative stays but never external booking dates',()=>{
  let p=edit(make({startsOn:'2026-10-25'}),{type:'add_stop',stop:stop('town-a',{status:'planned'})},'ev1').plan;
  p=edit(p,{type:'add_booking',booking:booking()},'ev2').plan;
  const moved=edit(p,{type:'edit_trip',patch:{starts_on:'2026-11-01'}},'ev3');
  assert.equal(moved.plan.bookings[0].starts_on,'2026-10-28');
  assert.deepEqual(itinerarySignals(moved.plan),[
    {code:'booking_plan_mismatch',booking_id:'booking-1',stop_id:'town-a'},
    {code:'booking_outside_trip',booking_id:'booking-1'}]);
  assert.equal(itineraryDays(moved.plan)[3].date,'2026-11-04');
  const restored=edit(moved.plan,{type:'undo_last'},'ev4',moved.event);
  assert.equal(restored.plan.starts_on,'2026-10-25');
  assert.deepEqual(itinerarySignals(restored.plan),[]);
});
test('shortening adventure may not discard a city stay silently',()=>{
  const p=edit(make(),{type:'add_stop',stop:stop('far',{from_day:19,through_day:22})},'ev1').plan;
  assert.throws(()=>edit(p,{type:'edit_trip',patch:{duration_days:14}},'ev2'),/duration conflicts/);
  assert.equal(p.duration_days,21);
});

test('audit event snapshots do not alias mutable current plan records',()=>{
  const saved=edit(make(),{type:'add_stop',stop:stop()},'audit-one');
  saved.plan.stops[0].title='Edited without event';
  assert.equal(saved.event.after.title,'town-a');
});
test('a confirmed hotel extending beyond departure is flagged without deleting it',()=>{
  const p=edit(make({startsOn:'2026-10-25'}),{type:'add_booking',booking:booking({stop_id:null,starts_on:'2026-11-13',ends_on:'2026-11-18'})},'hotel-overrun').plan;
  assert.deepEqual(itinerarySignals(p),[{code:'booking_outside_trip',booking_id:'booking-1'}]);
});

test('Unbooked day experiences remain distinct from supplier bookings and preserve Undo history',()=>{
  const original=make({startsOn:'2026-10-25'});
  const added=edit(original,{type:'add_experience',experience:{
    id:'visit-a',title:'Fictional museum',day:8,status:'possible',notes:'Flexible afternoon'
  }},'experience-1');
  assert.equal(added.plan.bookings.length,0);
  assert.equal(itineraryDays(added.plan)[7].experiences[0].title,'Fictional museum');
  assert.equal(itineraryDays(added.plan)[7].date,'2026-11-01','Local DST transition does not shift experience day');
  const moved=edit(added.plan,{type:'edit_experience',id:'visit-a',patch:{
    day:9,status:'planned',title:'Fictional gallery'
  }},'experience-2');
  assert.equal(itineraryDays(moved.plan)[7].experiences.length,0);
  assert.equal(itineraryDays(moved.plan)[8].experiences[0].status,'planned');
  assert.equal(moved.event.collection,'experiences');
  const undone=edit(moved.plan,{type:'undo_last'},'experience-3',moved.event);
  assert.deepEqual(undone.plan.experiences,added.plan.experiences);
  assert.equal(undone.plan.revision,3);
  assert.deepEqual(original.experiences,[]);
});

test('Experience edits reject invalid dates, fields, lost history and silent trip shortening',()=>{
  const first=edit(make(),{type:'add_experience',experience:{
    id:'visit-a',title:'Optional visit',day:20,status:'possible',notes:''
  }},'experience-1').plan;
  assert.throws(()=>edit(first,{type:'edit_trip',patch:{duration_days:10}},'experience-2'),
    /duration conflicts/);
  assert.throws(()=>edit(first,{type:'edit_experience',id:'visit-a',patch:{day:22}},'experience-3'),
    /experience day/);
  assert.throws(()=>edit(first,{type:'edit_experience',id:'visit-a',patch:{supplier_confirmed:true}},'experience-4'),
    /experience patch/);
  assert.throws(()=>edit(first,{type:'add_experience',experience:{
    id:'visit-a',title:'Duplicate',day:1,status:'planned',notes:''
  }},'experience-5'),/already exists/);
  const removed=edit(first,{type:'remove_experience',id:'visit-a'},'experience-6');
  assert.deepEqual(removed.plan.experiences,[]);
  assert.equal(removed.event.before.title,'Optional visit');
  assert.equal(removed.event.after,null);
});

test('Legacy snapshot without experiences stays editable and retains its original history shape',()=>{
  const old=make();delete old.experiences;
  const editOnLegacy=edit(old,{type:'add_experience',experience:{
    id:'new-item',title:'Flexible scenic walk',day:1,status:'possible',notes:''
  }},'experience-legacy');
  assert.equal(old.experiences,undefined);
  assert.equal(editOnLegacy.plan.experiences.length,1);
  assert.equal(editOnLegacy.event.before,null,'The new entry has no prior version');
});
