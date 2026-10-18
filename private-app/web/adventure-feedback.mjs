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
  const free=days.filter(d=>!d.stops.some(s=>s.status==='planned'));
  if(free.length)notices.push({severity:'info',code:'unassigned_overnights',
    description:free.length+' days have no planned overnight base.',
    evidence:{days:free.map(d=>d.day)},
    action:'Leave days open or add an intended stay; do not invent an accommodation booking.'});
  // A heuristic prompt, not a claim that activities actually conflict: we
  // have neither timings nor route-duration evidence in these records.
  for(const day of days){
    const planned=(day.experiences??[]).filter(e=>e.status==='planned');
    if(planned.length>=4)notices.push({severity:'info',code:'busy_day',
      description:'Day '+day.day+' has '+planned.length+' intended experiences.',
      evidence:{day:day.day,experience_ids:planned.map(e=>e.id)},
      action:'Consider the pace and leave room for travel or breaks; exact times and distances were not checked.'});
  }
  const tentativeTransfers=plan.bookings.filter(b=>['flight','transport'].includes(b.kind)&&b.status!=='confirmed');
  for(const b of tentativeTransfers)notices.push({severity:'info',code:'unconfirmed_transfer',
    description:'A possible transfer is not confirmed.',
    evidence:{booking_id:b.id},action:'Review the original supplier record before relying on it.'});
  return {adventure_id:plan.id,revision:plan.revision,notices,scope:'saved-itinerary-only',
    limitations:'No current route duration, supplier availability, geographic feasibility or actual reservation status was checked.'};
}
