import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createItinerary,applyItineraryEdit} from '../web/itinerary-core.mjs';
import {journeyOverview,dayDetail,nextAdventures,journeyWeeks} from '../web/journey-view.mjs';
import {journeyMap} from '../web/journey-map.mjs';
const make=(id='fictional')=>createItinerary({id,title:'Fictional journey',durationDays:6,startsOn:'2026-10-30'});
function change(p,c,id){return applyItineraryEdit(p,c,{eventId:id,actorId:'member-a',at:'2026-10-17T14:00:00Z'}).plan;}
test('Open nights and possible stops stay distinct across Toronto autumn DST transition',()=>{
 let p=change(make(),{type:'add_stop',stop:{id:'a',place_id:'a',title:'Fictional town',from_day:1,through_day:3,status:'planned'}},'e1');
 p=change(p,{type:'add_stop',stop:{id:'b',place_id:'b',title:'Possible town',from_day:2,through_day:5,status:'possible'}},'e2');
 const v=journeyOverview(p);
 assert.deepEqual(v.open_nights,[3,4,5,6]);
 assert.equal(v.stays[0].nights,2);assert.equal(v.stays[0].check_out,'2026-11-01');
 assert.deepEqual(dayDetail(p,2).possibilities.map(s=>s.id),['b']);
 assert.equal(dayDetail(p,4).planned.length,0);
 assert.throws(()=>dayDetail(p,0),/outside/);
});
test('Bookings remain separate anchors with no fictitious confirmed route',()=>{
 let p=change(make(),{type:'add_booking',booking:{id:'transfer',kind:'transport',stop_id:null,
   starts_on:'2026-10-31',ends_on:'2026-10-31',status:'unverified',summary:'Possible ferry',source_id:null}},'e1');
 const j=journeyOverview(p);assert.equal(j.transfers[0].verified,false);
 assert.equal(j.bookings[0].is_external_confirmation,false);
 assert.equal(j.has_map_points,false);
});
test('Current, upcoming, past, undated and archived adventures remain distinct',()=>{
 const now=make('now'),past={...make('past'),starts_on:'2026-09-01'};
 const undated={...make('undated'),starts_on:null};
 const archived={...make('archive'),status:'archived'};
 const x=nextAdventures([past,archived,undated,now],'2026-11-01');
 assert.deepEqual(x.current_and_upcoming.map(z=>z.id),['now']);
 assert.deepEqual(x.undated.map(z=>z.id),['undated']);
 assert.deepEqual(x.past.map(z=>z.id),['past']);
 assert.deepEqual(x.archived.map(z=>z.id),['archive']);
});


test('Approximate months are current/upcoming or earlier without invented daily dates',()=>{
 const approximate=createItinerary({id:'month-plan',title:'Synthetic December adventure',
   durationDays:21,startsMonth:'2027-12'});
 const earlier=createItinerary({id:'past-month',title:'Synthetic earlier month',
   startsMonth:'2026-09'});
 const undated=createItinerary({id:'undated-month-test',title:'Flexible idea'});
 const before=structuredClone(approximate);
 const groups=nextAdventures([undated,earlier,approximate],'2026-10-19');
 assert.deepEqual(groups.current_and_upcoming.map(x=>x.id),['month-plan']);
 assert.deepEqual(groups.past.map(x=>x.id),['past-month']);
 assert.deepEqual(groups.undated.map(x=>x.id),['undated-month-test']);
 const journey=journeyOverview(approximate);
 assert.equal(journey.starts_month,'2027-12');
 assert.equal(journey.starts_on,null);
 assert.ok(journey.days.every(d=>d.date===null));
 assert.equal(journey.stays.length,0);
 assert.deepEqual(approximate,before);
 const inDecember=nextAdventures([approximate],'2027-12-31');
 assert.deepEqual(inDecember.current_and_upcoming.map(x=>x.id),['month-plan']);
 assert.deepEqual(nextAdventures([approximate],'2028-01-01').past.map(x=>x.id),
   ['month-plan']);
});
test('A 21-day journey opens as three bounded week groups without losing date or day identity',()=>{
 const p=createItinerary({id:'three-weeks',title:'Fictional three-week adventure',durationDays:21,startsOn:'2026-10-25'});
 const weeks=journeyWeeks(p);
 assert.deepEqual(weeks.map(w=>[w.number,w.from_day,w.to_day]),[[1,1,7],[2,8,14],[3,15,21]]);
 assert.equal(weeks[0].from_date,'2026-10-25');
 assert.equal(weeks[2].to_date,'2026-11-14');
 assert.equal(weeks.flatMap(w=>w.days).length,21);
});

test('Map pins, booking context and day selections use one canonical itinerary',()=>{
  let p=change(make(),{type:'add_stop',stop:{id:'harbour',place_id:'harbour-place',
    title:'Fictional Harbour',from_day:2,through_day:4,status:'possible',
    latitude:49.2827,longitude:-123.1207}},'e1');
  p=change(p,{type:'add_stop',stop:{id:'inland',place_id:'inland-place',
    title:'Fictional Inland',from_day:4,through_day:6,status:'planned',
    latitude:50.1,longitude:-120.0}},'e2');
  p=change(p,{type:'add_booking',booking:{id:'hotel',kind:'stay',stop_id:'harbour',
    starts_on:'2026-10-31',ends_on:'2026-11-02',status:'confirmed',
    source_id:'fictional-source',summary:'Recorded fictional hotel'}},'e3');
  const map=journeyMap(p,2);
  assert.equal(map.places.length,2);
  assert.deepEqual(map.pins.map(v=>v.id),['harbour','inland']);
  assert.equal(map.places[0].on_day,true);
  assert.equal(map.places[1].on_day,false);
  assert.equal(map.places[0].bookings[0].id,'hotel');
  assert.equal(dayDetail(p,2).possibilities[0].id,map.places[0].id);
  assert.ok(map.pins.every(v=>v.x_percent>=15&&v.x_percent<=85&&
    v.y_percent>=15&&v.y_percent<=85),'Coordinate pins remain within view');
  assert.equal(map.places[0].booking_mismatch,false);
  assert.equal(journeyMap(p,4).places[1].on_day,true);
  assert.equal(journeyMap(p,4).places[0].on_day,false);
  assert.deepEqual(journeyMap(make()).pins,[]);
});
test('No guessed points, external data calls or invented transport lines',()=>{
  let p=change(make(),{type:'add_stop',stop:{id:'unknown',place_id:'unknown',
    title:'Fictional unspecified town',from_day:1,through_day:3,status:'planned'}},'e1');
  p=change(p,{type:'add_booking',booking:{id:'possible-flight',kind:'flight',stop_id:null,
    starts_on:'2026-10-31',ends_on:'2026-10-31',status:'unverified',
    source_id:null,summary:'Unverified transport'}},'e2');
  const map=journeyMap(p);
  assert.deepEqual(map.pins,[],'No guessed location from a name or transport');
  assert.equal(map.places[0].latitude,null);
  assert.equal(Object.hasOwn(map,'routes'),false,'No speculative travel path');
});
