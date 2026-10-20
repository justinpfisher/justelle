// Pure, opt-in feedback. No scheduled AI, remote search or booking actions.
// This is evidence from saved records, not a claim that travel is feasible.
import {itineraryDays,itinerarySignals} from './itinerary-core.mjs';
export function reviewAdventure(plan){
  const days=itineraryDays(plan),notices=[];
  for(const signal of itinerarySignals(plan)){
    const descriptions={
      overlapping_planned_stays:'Two intended overnight stays overlap.',
      booking_without_stop:'A confirmed booking has no matching intended stop.',
      booking_plan_mismatch:'An intended stay differs from the separate booking dates.',
      booking_outside_trip:'A confirmed booking falls outside the intended trip window.'
    };
    notices.push({severity:'review',code:signal.code,description:descriptions[signal.code]||'Check a planning conflict.',
      evidence:signal,action:'Inspect the linked booking or stay before deciding what to change.'});
  }
  // Member-recorded supplier confirmations and intended overnight bases are
  // independent records. A stay is not accounted for merely because a dated
  // booking exists; it must be linked to a currently planned base.
  for(const booked of plan.bookings.filter(b=>b.kind==='stay'&&b.status==='confirmed')){
    const base=plan.stops.find(s=>s.id===booked.stop_id&&s.status==='planned');
    if(!base)notices.push({severity:'review',code:'confirmed_stay_without_planned_base',
      description:'A member-recorded accommodation confirmation has no linked planned overnight base.',
      evidence:{booking_id:booked.id,starts_on:booked.starts_on,ends_on:booked.ends_on},
      action:'Check the original booking and link an intended place. Updating Justelle does not alter the reservation.'});
  }
  const free=days.filter(d=>!d.stops.some(s=>s.status==='planned'));
  if(free.length)notices.push({severity:'info',code:'unassigned_overnights',
    description:free.length+' days have no planned overnight base.',
    evidence:{days:free.map(d=>d.day)},
    action:'Leave days open or add an intended stay; do not invent an accommodation booking.'});
  // An intended overnight-base handover can be useful planning feedback,
  // but travel may legitimately be by car/walk with no supplier confirmation.
  // This never asserts an impossible connection, travel time or missing ticket.
  for(let i=1;i<days.length;i++){
    const previous=days[i-1].stops.filter(s=>s.status==='planned');
    const next=days[i].stops.filter(s=>s.status==='planned');
    if(previous.length!==1||next.length!==1||previous[0].id===next[0].id)continue;
    const date=days[i].date;
    const recorded=Boolean(date)&&plan.bookings.some(b=>
      ['flight','transport'].includes(b.kind)&&
      !['cancelled','voided'].includes(b.status)&&
      b.starts_on<=date&&b.ends_on>=date);
    if(!recorded)notices.push({severity:'info',code:'unrecorded_transfer',
      description:'Day '+days[i].day+' changes overnight base from '+previous[0].title+
        ' to '+next[0].title+' without a recorded transfer.',
      evidence:{day:days[i].day,from_stop_id:previous[0].id,to_stop_id:next[0].id},
      action:'If travel arrangements matter here, add an intended transfer. No route, timing or supplier availability was checked.'});
  }
  // A heuristic prompt, not a claim that activities actually conflict: we
  // have neither timings nor route-duration evidence in these records.
  for(const day of days){
    const planned=(day.experiences??[]).filter(e=>e.status==='planned');
    if(planned.length>=4)notices.push({severity:'info',code:'busy_day',
      description:'Day '+day.day+' has '+planned.length+' intended experiences.',
      evidence:{day:day.day,experience_ids:planned.map(e=>e.id)},
      action:'Consider the pace and leave room for travel or breaks; exact times and distances were not checked.'});
  }
  // Cancelled and voided supplier records are no longer travel options.
  // Do not invite members to treat them as merely awaiting confirmation.
  const tentativeTransfers=plan.bookings.filter(b=>['flight','transport'].includes(b.kind)&&
    b.status==='unverified');
  for(const b of tentativeTransfers)notices.push({severity:'info',code:'unconfirmed_transfer',
    description:'A possible transfer is not confirmed.',
    evidence:{booking_id:b.id},action:'Review the original supplier record before relying on it.'});
  return {adventure_id:plan.id,revision:plan.revision,notices,scope:'saved-itinerary-only',
    limitations:'No current route duration, supplier availability, geographic feasibility or actual reservation status was checked.'};
}
