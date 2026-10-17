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
