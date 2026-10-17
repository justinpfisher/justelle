import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createItinerary,applyItineraryEdit} from '../web/itinerary-core.mjs';
import {journeyOverview,dayDetail,nextAdventures,journeyWeeks} from '../web/journey-view.mjs';
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

test('A 21-day journey opens as three bounded week groups without losing date or day identity',()=>{
 const p=createItinerary({id:'three-weeks',title:'Fictional three-week adventure',durationDays:21,startsOn:'2026-10-25'});
 const weeks=journeyWeeks(p);
 assert.deepEqual(weeks.map(w=>[w.number,w.from_day,w.to_day]),[[1,1,7],[2,8,14],[3,15,21]]);
 assert.equal(weeks[0].from_date,'2026-10-25');
 assert.equal(weeks[2].to_date,'2026-11-14');
 assert.equal(weeks.flatMap(w=>w.days).length,21);
});
