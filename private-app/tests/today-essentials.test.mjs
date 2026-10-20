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

test('Today shows intended and possible day experiences separately without inventing a confirmation',()=>{
 let p=createItinerary({id:'journey',title:'Synthetic visit',startsOn:'2026-10-31',durationDays:4});
 p=edit(p,{type:'add_experience',experience:{
   id:'monday',title:'Museum',day:2,status:'planned',notes:'Afternoon'
 }},'one');
 p=edit(p,{type:'add_experience',experience:{
   id:'optional',title:'Garden',day:2,status:'possible',notes:'If weather allows'
 }},'two');
 p=edit(p,{type:'add_experience',experience:{
   id:'tomorrow',title:'Gallery',day:3,status:'planned',notes:''
 }},'three');
 const before=structuredClone(p);
 const d=todayEssentials(p,'2026-11-01');
 assert.deepEqual(d.planned_experiences,[{id:'monday',title:'Museum',notes:'Afternoon'}]);
 assert.deepEqual(d.possible_experiences,[{id:'optional',title:'Garden',notes:'If weather allows'}]);
 assert.deepEqual(d.tomorrow.planned_experiences,['Gallery']);
 assert.deepEqual(d.bookings,[],'Experiences are not supplier-confirmed bookings');
 assert.deepEqual(p,before,'Travel-day projection is read-only');
 const outside=todayEssentials(p,'2026-10-29');
 assert.deepEqual(outside.planned_experiences,[]);
 assert.deepEqual(outside.possible_experiences,[]);
});

test('Legacy adventure days have no fabricated activities',()=>{
 const legacy=createItinerary({id:'legacy',title:'Old journey',durationDays:5,startsOn:'2026-11-01'});
 delete legacy.experiences;
 const d=todayEssentials(legacy,'2026-11-02');
 assert.deepEqual(d.planned_experiences,[]);
 assert.deepEqual(d.possible_experiences,[]);
 assert.deepEqual(d.tomorrow.planned_experiences,[]);
});

test('Cancelled/voided supplier records never appear as active or merely unverified Today commitments',()=>{
 let p=createItinerary({id:'today-cancel',title:'Fictional stay',startsOn:'2026-11-01',durationDays:4});
 const b=(id,status)=>({id,kind:'stay',stop_id:null,starts_on:'2026-11-01',
   ends_on:'2026-11-04',status,source_id:'fictional-source',summary:'Synthetic '+id});
 p=edit(p,{type:'add_booking',booking:b('hotel','confirmed')},'one');
 p=edit(p,{type:'add_booking',booking:b('old','cancelled')},'two');
 p=edit(p,{type:'add_booking',booking:b('void','voided')},'three');
 const before=structuredClone(p),d=todayEssentials(p,'2026-11-02');
 assert.deepEqual(d.bookings.map(x=>x.id),['hotel']);
 assert.deepEqual(d.uncertain,[]);
 assert.deepEqual(d.cancelled.map(x=>x.id),['old','void']);
 assert.deepEqual(p,before);
 const cancelled=edit(p,{type:'correct_booking',id:'hotel',patch:{status:'cancelled'}},'four');
 assert.deepEqual(todayEssentials(cancelled,'2026-11-02').bookings,[]);
});
test('Two overlapping planned overnight bases are reported as ambiguous, not arbitrarily chosen',()=>{
 let p=createItinerary({id:'overnight',title:'Fictional route',startsOn:'2026-10-31',durationDays:5});
 p=edit(p,{type:'add_stop',stop:{id:'east',place_id:'east',title:'Fictional East',
   from_day:1,through_day:4,status:'planned'}},'one');
 p=edit(p,{type:'add_stop',stop:{id:'west',place_id:'west',title:'Fictional West',
   from_day:2,through_day:5,status:'planned'}},'two');
 const x=todayEssentials(p,'2026-11-01');
 assert.equal(x.overnight,null);
 assert.deepEqual(x.overnight_conflict.map(c=>c.id),['east','west']);
 assert.deepEqual(todayEssentials(p,'2026-10-30').overnight_conflict,[]);
});
test('Travel bookings precede accommodation in Today without inventing clock times',()=>{
 let p=createItinerary({id:'order',title:'Fictional trip',startsOn:'2026-11-01',durationDays:3});
 const booking=(id,kind,dates)=>({id,kind,stop_id:null,status:'confirmed',
   source_id:'synthetic-source',summary:id,starts_on:dates[0],ends_on:dates[1]});
 p=edit(p,{type:'add_booking',booking:booking('hotel','stay',['2026-11-01','2026-11-04'])},'one');
 p=edit(p,{type:'add_booking',booking:booking('event','activity',['2026-11-02','2026-11-02'])},'two');
 p=edit(p,{type:'add_booking',booking:booking('rail','transport',['2026-11-02','2026-11-02'])},'three');
 const x=todayEssentials(p,'2026-11-02');
 assert.deepEqual(x.bookings.map(b=>b.id),['rail','hotel','event']);
 assert.equal(x.bookings[0].starts_on,'2026-11-02');
 assert.equal(Object.hasOwn(x.bookings[0],'starts_at'),false,'No fabricated departure time');
});

test('Today highlights the member-recorded hotel and earliest dated booking without invented times',()=>{
 let p=createItinerary({id:'essentials',title:'Fictional journey',startsOn:'2026-11-01',durationDays:5});
 p=edit(p,{type:'add_stop',stop:{id:'base',place_id:'base',title:'Fictional central',
   from_day:1,through_day:6,status:'planned',latitude:43.71,longitude:-79.25}},'stay');
 const b=(id,kind,date,ends,status='confirmed',source='fictional-source')=>({
   id,kind,stop_id:kind==='stay'?'base':null,status,source_id:source,
   summary:'Synthetic '+id,starts_on:date,ends_on:ends});
 p=edit(p,{type:'add_booking',booking:b('hotel','stay','2026-11-01','2026-11-05')},'one');
 p=edit(p,{type:'add_booking',booking:b('plane','flight','2026-11-02','2026-11-02')},'two');
 p=edit(p,{type:'add_booking',booking:b('rail','transport','2026-11-03','2026-11-03')},'three');
 p=edit(p,{type:'add_booking',booking:b('cancelled-flight','flight','2026-11-02','2026-11-02','cancelled')},'four');
 p=edit(p,{type:'add_booking',booking:b('unconfirmed','activity','2026-11-02','2026-11-02','unverified',null)},'five');
 const original=structuredClone(p),d=todayEssentials(p,'2026-11-02');
 assert.equal(d.stay_booking.id,'hotel');
 assert.equal(d.stay_booking.stop_id,'base');
 assert.deepEqual(d.stay_booking_conflict,[]);
 assert.equal(d.next_booking.id,'plane');
 assert.deepEqual(d.bookings.map(x=>x.id),['plane','hotel']);
 assert.deepEqual(d.cancelled.map(x=>x.id),['cancelled-flight']);
 assert.deepEqual(d.uncertain.map(x=>x.id),['unconfirmed']);
 assert.deepEqual(d.tomorrow.bookings.map(x=>x.id),['rail']);
 assert.equal(Object.hasOwn(d.next_booking,'time'),false);
 assert.match(d.limitations,/without verified supplier updates, clock times/);
 assert.deepEqual(p,original,'Essentials never rewrite the canonical booking or plan');
});
test('Multiple active hotel confirmations remain explicitly ambiguous',()=>{
 let p=createItinerary({id:'hotels',title:'Fictional hotels',startsOn:'2026-11-01',durationDays:4});
 const hotel=(id)=>({id,kind:'stay',stop_id:null,status:'confirmed',source_id:'source-'+id,
   starts_on:'2026-11-01',ends_on:'2026-11-04',summary:id});
 p=edit(p,{type:'add_booking',booking:hotel('hotel-a')},'one');
 p=edit(p,{type:'add_booking',booking:hotel('hotel-b')},'two');
 const d=todayEssentials(p,'2026-11-02');
 assert.equal(d.stay_booking,null);
 assert.deepEqual(d.stay_booking_conflict.map(x=>x.id),['hotel-a','hotel-b']);
 assert.equal(d.next_booking,null);
});
test('Future booking lookup excludes cancelled records, current stays and post-trip dates',()=>{
 let p=createItinerary({id:'next',title:'Fictional dates',startsOn:'2026-11-01',durationDays:3});
 const booking=(id,kind,date,ends,status='confirmed')=>({id,kind,stop_id:null,
   status,source_id:'source',summary:id,starts_on:date,ends_on:ends});
 p=edit(p,{type:'add_booking',booking:booking('hotel','stay','2026-11-01','2026-11-03')},'one');
 p=edit(p,{type:'add_booking',booking:booking('cancelled','flight','2026-11-02','2026-11-02','cancelled')},'two');
 p=edit(p,{type:'add_booking',booking:booking('next-rail','transport','2026-11-03','2026-11-03')},'three');
 p=edit(p,{type:'add_booking',booking:booking('after-trip','flight','2026-11-06','2026-11-06')},'four');
 const d=todayEssentials(p,'2026-11-02');
 assert.equal(d.next_booking.id,'next-rail');
 assert.equal(d.stay_booking.id,'hotel');
 assert.deepEqual(d.tomorrow.bookings.map(x=>x.id),['next-rail']);
 const outside=todayEssentials(p,'2026-10-31');
 assert.equal(outside.in_trip,false);
 assert.equal(outside.next_booking,null);
 assert.deepEqual(outside.stay_booking_conflict,[]);
});
