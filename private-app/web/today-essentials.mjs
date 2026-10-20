// Travel-day essentials derived from local calendar dates and saved records.
// Read-only: dates do not establish supplier truth, exact times or offline access.
import {itineraryDays} from './itinerary-core.mjs';
const priority={flight:0,transport:1,stay:2,activity:3};
const confirmed=b=>b.status==='confirmed'&&Boolean(b.source_id);
const ordered=(a,b)=>a.starts_on.localeCompare(b.starts_on)||
  priority[a.kind]-priority[b.kind]||a.id.localeCompare(b.id);
const brief=b=>({id:b.id,kind:b.kind,summary:b.summary,source_id:b.source_id,
  starts_on:b.starts_on,stop_id:b.stop_id});

export function todayEssentials(plan,localDate){
 if(!/^\d{4}-\d{2}-\d{2}$/.test(localDate))throw Error('Select a local calendar date');
 const days=itineraryDays(plan),today=days.find(d=>d.date===localDate);
 if(!today)return {in_trip:false,date:localDate,bookings:[],overnight:null,tomorrow:null,
  uncertain:[],cancelled:[],overnight_conflict:[],stay_booking:null,
  stay_booking_conflict:[],next_booking:null,
  planned_experiences:[],possible_experiences:[]};
 const tomorrow=days.find(d=>d.day===today.day+1)||null;
 // A cancelled/voided record cannot become the next travel commitment.
 const cancelled=today.bookings.filter(b=>['cancelled','voided'].includes(b.status));
 const active=today.bookings.filter(b=>!['cancelled','voided'].includes(b.status));
 const current=active.filter(confirmed).sort(ordered);
 const uncertain=active.filter(b=>!confirmed(b));
 const currentHotels=current.filter(b=>b.kind==='stay');
 const intendedBases=today.stops.filter(s=>s.status==='planned');
 // Only calendar-day ordering is known. Do not claim which of several same-day
 // bookings happens next when time-of-day was never captured.
 const next=plan.bookings.filter(b=>confirmed(b)&&
   b.starts_on>=localDate&&b.starts_on<=days.at(-1).date&&
   !(b.kind==='stay'&&b.starts_on<=localDate&&localDate<b.ends_on))
   .sort(ordered)[0]||null;
 const tomorrowBookings=tomorrow?plan.bookings
   .filter(b=>confirmed(b)&&b.starts_on===tomorrow.date)
   .sort(ordered).map(brief):[];
 return {in_trip:true,date:localDate,day:today.day,
  bookings:current.map(brief),
  stay_booking:currentHotels.length===1?brief(currentHotels[0]):null,
  stay_booking_conflict:currentHotels.length>1?currentHotels.map(brief):[],
  next_booking:next?brief(next):null,
  overnight:intendedBases.length===1?intendedBases[0]:null,
  overnight_conflict:intendedBases.length>1?intendedBases.map(s=>({id:s.id,title:s.title})):[],
  planned_experiences:(today.experiences??[]).filter(e=>e.status==='planned')
    .map(e=>({id:e.id,title:e.title,notes:e.notes})),
  possible_experiences:(today.experiences??[]).filter(e=>e.status==='possible')
    .map(e=>({id:e.id,title:e.title,notes:e.notes})),
  tomorrow:tomorrow?{date:tomorrow.date,
    planned_places:tomorrow.stops.filter(s=>s.status==='planned').map(s=>s.title),
    planned_experiences:(tomorrow.experiences??[]).filter(e=>e.status==='planned').map(e=>e.title),
    bookings:tomorrowBookings}:null,
  uncertain:uncertain.map(b=>({id:b.id,summary:b.summary,status:b.status})),
  cancelled:cancelled.map(b=>({id:b.id,summary:b.summary,status:b.status})),
  limitations:'Dates are member-recorded, without verified supplier updates, clock times or offline document copies.'};
}
