// Travel-day essentials derived from local calendar dates and actual saved records.
// This is read-only and does not claim location, live reservations or offline access.
import {itineraryDays} from './itinerary-core.mjs';
export function todayEssentials(plan,localDate){
 if(!/^\d{4}-\d{2}-\d{2}$/.test(localDate))throw Error('Select a local calendar date');
 const days=itineraryDays(plan),today=days.find(d=>d.date===localDate);
 if(!today)return {in_trip:false,date:localDate,bookings:[],overnight:null,tomorrow:null,uncertain:[]};
 const tomorrow=days.find(d=>d.day===today.day+1)||null;
 const confirmed=today.bookings.filter(b=>b.status==='confirmed'&&b.source_id);
 const uncertain=today.bookings.filter(b=>!(b.status==='confirmed'&&b.source_id));
 return {in_trip:true,date:localDate,day:today.day,
  bookings:confirmed.map(b=>({id:b.id,kind:b.kind,summary:b.summary,source_id:b.source_id,starts_on:b.starts_on})),
  overnight:today.stops.find(s=>s.status==='planned')||null,
  tomorrow:tomorrow?{date:tomorrow.date,planned_places:tomorrow.stops.filter(s=>s.status==='planned').map(s=>s.title)}:null,
  uncertain:uncertain.map(b=>({id:b.id,summary:b.summary,status:b.status})),
  limitations:'Current plans and copied booking records are not live supplier confirmations or offline copies.'};
}
