import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createItinerary,applyItineraryEdit} from '../web/itinerary-core.mjs';
import {reviewAdventure} from '../web/adventure-feedback.mjs';
const base=()=>createItinerary({id:'fictional-feedback',title:'Synthetic trip',durationDays:5,startsOn:'2026-10-30'});
function edit(p,change,eventId){return applyItineraryEdit(p,change,{eventId,actorId:'person-a',at:'2026-10-17T14:00:00Z'}).plan;}
test('Feedback is explicit, bounded and labels uncovered nights without manufacturing reservations',()=>{
 const p=base();const result=reviewAdventure(p);
 assert.equal(result.notices[0].code,'unassigned_overnights');
 assert.deepEqual(result.notices[0].evidence.days,[1,2,3,4,5]);
 assert.deepEqual(p.bookings,[]);
 assert.match(result.limitations,/No current route duration/);
});
test('Mismatched confirmed supplier anchor is flagged, never silently rebooked',()=>{
 let p=edit(base(),{type:'add_stop',stop:{id:'one',place_id:'one',title:'Fictional town',from_day:1,through_day:3,status:'planned'}},'e1');
 p=edit(p,{type:'add_booking',booking:{id:'b1',kind:'stay',stop_id:'one',starts_on:'2026-11-01',
   ends_on:'2026-11-03',status:'confirmed',source_id:'source-1',summary:'Fictional booking'}},'e2');
 const old=structuredClone(p.bookings);
 const result=reviewAdventure(p);
 assert.equal(result.notices[0].code,'booking_plan_mismatch');
 assert.deepEqual(p.bookings,old);
});
test('Tentative transfers are labelled as uncertain and do not imply an AI review ran',()=>{
 const p=edit(base(),{type:'add_booking',booking:{id:'boat',kind:'transport',stop_id:null,
   starts_on:'2026-11-01',ends_on:'2026-11-01',status:'unverified',source_id:null,summary:'Possibility'}},'e1');
 assert.equal(reviewAdventure(p).notices.some(n=>n.code==='unconfirmed_transfer'),true);
});

test('Four planned experiences trigger a disclosed pacing heuristic, not a fabricated booking conflict',()=>{
 let p=base();
 for(let i=0;i<4;i++)p=edit(p,{type:'add_experience',experience:{
   id:'visit-'+i,title:'Synthetic visit '+i,day:2,status:'planned',notes:''
 }},'activity-'+i);
 const snapshot=structuredClone(p);
 const result=reviewAdventure(p);
 const busy=result.notices.find(n=>n.code==='busy_day');
 assert.equal(busy.description,'Day 2 has 4 intended experiences.');
 assert.deepEqual(busy.evidence.experience_ids,['visit-0','visit-1','visit-2','visit-3']);
 assert.match(busy.action,/not checked/);
 assert.equal(busy.severity,'info');
 assert.deepEqual(p,snapshot,'Checking the itinerary must never edit it');
});

test('Three planned plus any number of possible experiences produce no false busy-day warning',()=>{
 let p=base();
 for(let i=0;i<6;i++)p=edit(p,{type:'add_experience',experience:{
   id:'stop-'+i,title:'Synthetic visit '+i,day:3,status:i<3?'planned':'possible',notes:''
 }},'idea-'+i);
 assert.equal(reviewAdventure(p).notices.some(n=>n.code==='busy_day'),false);
 const legacy=structuredClone(p);delete legacy.experiences;
 assert.equal(reviewAdventure(legacy).notices.some(n=>n.code==='busy_day'),false,
   'Old records without day experiences remain readable');
});
