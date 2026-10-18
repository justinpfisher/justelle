import {test} from 'node:test';import assert from 'node:assert/strict';
import {createItinerary,applyItineraryEdit} from '../web/itinerary-core.mjs';
import {todayEssentials} from '../web/today-essentials.mjs';
function edit(p,c,id){return applyItineraryEdit(p,c,{eventId:id,actorId:'person-a',at:'2026-10-17T12:00:00Z'}).plan;}
test('Today follows trip-local dates through DST and exposes only sourced bookings as confirmed',()=>{
 let p=createItinerary({id:'fictional',title:'Fictional Today',startsOn:'2026-10-31',durationDays:4});
 p=edit(p,{type:'add_stop',stop:{id:'stay',place_id:'stay',title:'Fictional city',from_day:1,through_day:4,status:'planned'}},'one');
 p=edit(p,{type:'add_booking',booking:{id:'b',kind:'stay',stop_id:'stay',starts_on:'2026-10-31',ends_on:'2026-11-03',status:'confirmed',source_id:'source',summary:'Fictional hotel'}},'two');
 const d=todayEssentials(p,'2026-11-01');assert.equal(d.day,2);
 assert.equal(d.bookings[0].source_id,'source');assert.equal(d.tomorrow.date,'2026-11-02');
 assert.equal(d.overnight.title,'Fictional city');
});
test('Undated and out-of-trip records do not invent a Today itinerary',()=>{
 const p=createItinerary({id:'undated',title:'Idea',durationDays:7});
 assert.equal(todayEssentials(p,'2026-10-17').in_trip,false);
 assert.throws(()=>todayEssentials(p,'tomorrow'),/calendar date/);
});
