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

test('Cancelled and voided transfers are not misrepresented as possible connections',()=>{
 let p=base();
 for(const [id,status] of [['cancelled-rail','cancelled'],['voided-flight','voided'],
   ['possible-ferry','unverified']]){
   p=edit(p,{type:'add_booking',booking:{id,kind:id.includes('flight')?'flight':'transport',
     stop_id:null,starts_on:'2026-11-01',ends_on:'2026-11-01',status,
     source_id:null,summary:'Synthetic '+id}},id);
 }
 const original=structuredClone(p),review=reviewAdventure(p);
 assert.deepEqual(review.notices.filter(n=>n.code==='unconfirmed_transfer')
   .map(n=>n.evidence.booking_id),['possible-ferry']);
 assert.deepEqual(p,original);
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

test('Member-recorded accommodation without a linked planned base prompts review, not rebooking',()=>{
 let p=edit(base(),{type:'add_booking',booking:{id:'hotel',kind:'stay',stop_id:null,
   starts_on:'2026-10-31',ends_on:'2026-11-02',status:'confirmed',
   source_id:'synthetic-source',summary:'Fictional hotel'}},'e1');
 const unchanged=structuredClone(p);
 const review=reviewAdventure(p);
 const notice=review.notices.find(n=>n.code==='confirmed_stay_without_planned_base');
 assert.equal(notice.severity,'review');
 assert.deepEqual(notice.evidence,{booking_id:'hotel',starts_on:'2026-10-31',ends_on:'2026-11-02'});
 assert.match(notice.action,/does not alter the reservation/);
 assert.deepEqual(p,unchanged);
 p=edit(p,{type:'add_stop',stop:{id:'town',place_id:'town',title:'Fictional town',
   from_day:2,through_day:4,status:'planned'}},'e2');
 const linked=edit(p,{type:'correct_booking',id:'hotel',patch:{stop_id:'town'}},'e3');
 assert.equal(reviewAdventure(linked).notices.some(n=>n.code==='confirmed_stay_without_planned_base'),false);
});
test('Possible linked places and tentative bookings never count as planned confirmed overnights',()=>{
 let p=edit(base(),{type:'add_stop',stop:{id:'town',place_id:'town',title:'Fictional town',
   from_day:2,through_day:4,status:'possible'}},'e1');
 p=edit(p,{type:'add_booking',booking:{id:'hotel',kind:'stay',stop_id:'town',
   starts_on:'2026-10-31',ends_on:'2026-11-02',status:'confirmed',
   source_id:'synthetic-source',summary:'Member-recorded booking'}},'e2');
 assert.equal(reviewAdventure(p).notices.some(n=>n.code==='confirmed_stay_without_planned_base'),true);
 const unverified=edit(p,{type:'correct_booking',id:'hotel',patch:{status:'unverified'}},'e3');
 assert.equal(reviewAdventure(unverified).notices.some(n=>n.code==='confirmed_stay_without_planned_base'),false);
});

test('Opt-in feedback finds unrecorded handovers without inventing bookings or journey times',()=>{
 let p=edit(base(),{type:'add_stop',stop:{id:'a',place_id:'a',
   title:'Fictional coast',from_day:1,through_day:3,status:'planned'}},'e1');
 p=edit(p,{type:'add_stop',stop:{id:'b',place_id:'b',
   title:'Fictional hills',from_day:3,through_day:6,status:'planned'}},'e2');
 const unchanged=structuredClone(p),result=reviewAdventure(p);
 const warning=result.notices.find(n=>n.code==='unrecorded_transfer');
 assert.equal(warning.severity,'info');
 assert.equal(warning.evidence.day,3);
 assert.equal(warning.evidence.from_stop_id,'a');
 assert.equal(warning.evidence.to_stop_id,'b');
 assert.match(warning.action,/No route, timing or supplier availability was checked/);
 assert.deepEqual(p,unchanged);
 p=edit(p,{type:'add_booking',booking:{id:'car',kind:'transport',stop_id:null,
   starts_on:'2026-10-30',ends_on:'2026-10-30',status:'unverified',
   source_id:null,summary:'Maybe rent a car'}},'e3');
 assert.equal(reviewAdventure(p).notices.some(n=>n.code==='unrecorded_transfer'),true,
   'A different-day transfer is not evidence for the day 3 handover');
 p=edit(p,{type:'correct_booking',id:'car',patch:{
   starts_on:'2026-10-30',ends_on:'2026-11-01'}},'e4');
 assert.equal(reviewAdventure(p).notices.some(n=>n.code==='unrecorded_transfer'),false,
   'A recorded but unverified transfer is a distinct informational warning');
 assert.equal(reviewAdventure(p).notices.some(n=>n.code==='unconfirmed_transfer'),true);
});
test('Possible stops or ambiguous overlapping bases do not create imaginary transfers',()=>{
 let p=edit(base(),{type:'add_stop',stop:{id:'a',place_id:'a',title:'Fictional home',
   from_day:1,through_day:4,status:'planned'}},'e1');
 p=edit(p,{type:'add_stop',stop:{id:'b',place_id:'b',title:'Tentative option',
   from_day:3,through_day:6,status:'possible'}},'e2');
 assert.equal(reviewAdventure(p).notices.some(n=>n.code==='unrecorded_transfer'),false);
});

test('Source-coordinate separation flags a long intended handover without inventing a route',()=>{
 let p=edit(base(),{type:'add_stop',stop:{id:'near',place_id:'near',
   title:'Fictional West',from_day:1,through_day:3,status:'planned',
   latitude:0,longitude:0}},'near-stop');
 p=edit(p,{type:'add_stop',stop:{id:'far',place_id:'far',
   title:'Fictional East',from_day:3,through_day:6,status:'planned',
   latitude:0,longitude:6}},'far-stop');
 const unchanged=structuredClone(p),review=reviewAdventure(p);
 const notice=review.notices.find(n=>n.code==='long_distance_handover');
 assert.equal(notice.severity,'info');
 assert.equal(notice.evidence.day,3);
 assert.equal(notice.evidence.from_stop_id,'near');
 assert.equal(notice.evidence.to_stop_id,'far');
 assert.equal(notice.evidence.straight_line_km,670);
 assert.match(notice.action,/not a route, travel duration, or supplier confirmation/);
 assert.deepEqual(p,unchanged);
 p=edit(p,{type:'add_booking',booking:{id:'tentative',kind:'transport',stop_id:null,
   starts_on:'2026-11-01',ends_on:'2026-11-01',status:'unverified',
   source_id:null,summary:'Maybe travel'}},'tentative');
 assert.ok(reviewAdventure(p).notices.some(n=>n.code==='long_distance_handover'),
   'An unverified plan is not a supplier-backed transfer');
 p=edit(p,{type:'correct_booking',id:'tentative',patch:{
   status:'confirmed',source_id:'synthetic-source'}},'confirmed');
 assert.equal(reviewAdventure(p).notices.some(n=>n.code==='long_distance_handover'),false,
   'A member-recorded source-backed transfer suppresses the notice, not the need for route verification');
});
test('Missing coordinates, undated trips and only possible places do not invent distance warnings',()=>{
 let p=edit(base(),{type:'add_stop',stop:{id:'known',place_id:'known',
   title:'Synthetic Known',from_day:1,through_day:3,status:'planned',
   latitude:0,longitude:0}},'known');
 p=edit(p,{type:'add_stop',stop:{id:'unknown',place_id:'unknown',
   title:'Synthetic Unknown',from_day:3,through_day:6,status:'planned'}},'unknown');
 assert.equal(reviewAdventure(p).notices.some(n=>n.code==='long_distance_handover'),false);
 p=edit(p,{type:'edit_stop',id:'unknown',patch:{latitude:0,longitude:6}},'coordinate');
 const undated=structuredClone(p);undated.starts_on=null;
 assert.equal(reviewAdventure(undated).notices.some(n=>n.code==='long_distance_handover'),false);
 const possible=edit(p,{type:'edit_stop',id:'unknown',patch:{status:'possible'}},'possible');
 assert.equal(reviewAdventure(possible).notices.some(n=>n.code==='long_distance_handover'),false);
});
test('Antimeridian handovers use the shorter arc, not a fictional 358-degree journey',()=>{
 let p=edit(base(),{type:'add_stop',stop:{id:'east',place_id:'east',
   title:'Fictional East Island',from_day:1,through_day:3,status:'planned',
   latitude:10,longitude:179}},'east');
 p=edit(p,{type:'add_stop',stop:{id:'west',place_id:'west',
   title:'Fictional West Island',from_day:3,through_day:6,status:'planned',
   latitude:10,longitude:-179}},'west');
 assert.equal(reviewAdventure(p).notices.some(n=>n.code==='long_distance_handover'),false);
});
