// Provider-neutral journey presentation: every view projects the same saved plan.
// An unverified transport anchor never becomes a booked transfer or route line.
import {itineraryDays,itinerarySignals,sortAdventurePlans} from './itinerary-core.mjs';
export function bookingStatusText(status){
  return ({
    confirmed:'Member-recorded confirmation',
    unverified:'Possible or unverified',
    cancelled:'Cancelled (recorded by a member)',
    voided:'Voided (recorded by a member)'
  })[status]||'Unknown booking status';
}
const dateAfter=(start,n)=>{
  if(!start)return null;
  const d=new Date(start+'T12:00:00Z');d.setUTCDate(d.getUTCDate()+n);
  return d.toISOString().slice(0,10);
};
export function journeyOverview(plan){
  const days=itineraryDays(plan),signals=itinerarySignals(plan);
  const stays=plan.stops.slice().sort((a,b)=>a.from_day-b.from_day||a.id.localeCompare(b.id))
    .map(s=>({...s,nights:s.through_day-s.from_day,
      check_in:dateAfter(plan.starts_on,s.from_day-1),
      check_out:dateAfter(plan.starts_on,s.through_day-1),
      confirmed_booking_ids:plan.bookings.filter(b=>b.status==='confirmed'&&b.stop_id===s.id).map(b=>b.id)}));
  const assigned=new Set(stays.filter(s=>s.status==='planned').flatMap(s=>
    Array.from({length:s.nights},(_,i)=>s.from_day+i)));
  const openNights=days.filter(d=>!assigned.has(d.day)).map(d=>d.day);
  // Cancelled/voided supplier records belong in booking history, not the
  // active journey shape. Never invite reliance on an obsolete connection.
  const transfers=plan.bookings.filter(b=>['flight','transport'].includes(b.kind)&&
    !['cancelled','voided'].includes(b.status))
    .map(b=>({...b,verified:b.status==='confirmed'&&Boolean(b.source_id)}));
  const bookings=plan.bookings.map(b=>({...b,is_external_confirmation:b.status==='confirmed'&&Boolean(b.source_id)}));
  return {id:plan.id,title:plan.title,status:plan.status,revision:plan.revision,
    duration_days:plan.duration_days,starts_on:plan.starts_on,
    starts_month:plan.starts_month??null,stays,days,open_nights:openNights,
    transfers,bookings,signals,has_map_points:stays.some(s=>s.latitude!==null)};
}
export function dayDetail(plan,day){
  const journey=journeyOverview(plan);
  if(!Number.isInteger(day)||day<1||day>journey.days.length)throw Error('Day outside the adventure');
  const item=journey.days[day-1];
  return {...item,confirmed:journey.bookings.filter(b=>b.is_external_confirmation&&
    item.bookings.some(d=>d.id===b.id)),possibilities:item.stops.filter(s=>s.status==='possible'),
    planned:item.stops.filter(s=>s.status==='planned')};
}
export function nextAdventures(plans,today){
  const sorted=sortAdventurePlans(plans,today);
  return {current_and_upcoming:sorted.filter(p=>p.status!=='archived'&&(
      p.starts_on ? dateAfter(p.starts_on,p.duration_days-1)>=today :
      p.starts_month ? p.starts_month>=today.slice(0,7) : false)),
    past:sorted.filter(p=>p.status!=='archived'&&(
      p.starts_on ? dateAfter(p.starts_on,p.duration_days-1)<today :
      p.starts_month ? p.starts_month<today.slice(0,7) : false)),
    undated:sorted.filter(p=>p.status!=='archived'&&!p.starts_on&&!p.starts_month),
    archived:sorted.filter(p=>p.status==='archived')};
}

// Progressive detail: groups local calendar days into small, expandable weeks
// without assuming that the first day must be a Monday.
export function journeyWeeks(plan){
  const days=itineraryDays(plan),weeks=[];
  for(let start=0;start<days.length;start+=7){
    const chunk=days.slice(start,start+7);
    weeks.push({number:weeks.length+1,from_day:chunk[0].day,to_day:chunk.at(-1).day,
      from_date:chunk[0].date,to_date:chunk.at(-1).date,days:chunk});
  }
  return weeks;
}
