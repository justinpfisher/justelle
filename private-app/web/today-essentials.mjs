// Travel-day essentials derived from local calendar dates and actual saved records.
// This is read-only and does not claim location, live reservations or offline access.
import {itineraryDays} from './itinerary-core.mjs';
export function todayEssentials(plan,localDate){
 if(!/^\d{4}-\d{2}-\d{2}$/.test(localDate))throw Error('Select a local calendar date');
 const days=itineraryDays(plan),today=days.find(d=>d.date===localDate);
 if(!today)return {in_trip:false,date:localDate,bookings:[],overnight:null,tomorrow:null,
  uncertain:[],cancelled:[],overnight_conflict:[],
  planned_experiences:[],possible_experiences:[]};
 const tomorrow=days.find(d=>d.day===today.day+1)||null;
 // A cancelled/voided reservation is not an unverified travel option. Never
 // place it among actionable confirmations or silently treat it as valid.
 const cancelled=today.bookings.filter(b=>['cancelled','voided'].includes(b.status));
 const active=today.bookings.filter(b=>!['cancelled','voided'].includes(b.status));
 const priority={flight:0,transport:1,stay:2,activity:3};
 const confirmed=active.filter(b=>b.status==='confirmed'&&b.source_id).sort((a,b)=>
   priority[a.kind]-priority[b.kind]||a.id.localeCompare(b.id));
 const uncertain=active.filter(b=>!(b.status==='confirmed'&&b.source_id));
 const intendedBases=today.stops.filter(s=>s.status==='planned');
 return {in_trip:true,date:localDate,day:today.day,
  bookings:confirmed.map(b=>({id:b.id,kind:b.kind,summary:b.summary,source_id:b.source_id,starts_on:b.starts_on})),
  overnight:intendedBases.length===1?intendedBases[0]:null,
  overnight_conflict:intendedBases.length>1?intendedBases.map(s=>({id:s.id,title:s.title})):[],
  planned_experiences:(today.experiences??[]).filter(e=>e.status==='planned')
    .map(e=>({id:e.id,title:e.title,notes:e.notes})),
  possible_experiences:(today.experiences??[]).filter(e=>e.status==='possible')
    .map(e=>({id:e.id,title:e.title,notes:e.notes})),
  tomorrow:tomorrow?{date:tomorrow.date,
    planned_places:tomorrow.stops.filter(s=>s.status==='planned').map(s=>s.title),
    planned_experiences:(tomorrow.experiences??[]).filter(e=>e.status==='planned').map(e=>e.title)}:null,
  uncertain:uncertain.map(b=>({id:b.id,summary:b.summary,status:b.status})),
  cancelled:cancelled.map(b=>({id:b.id,summary:b.summary,status:b.status})),
  limitations:'Current plans and copied booking records are not live supplier confirmations or offline copies.'};
}
