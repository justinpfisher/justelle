// Pure, opt-in feedback. No scheduled AI, remote search or booking actions.
// This is evidence from saved records, not a claim that travel is feasible.
import {itineraryDays,itinerarySignals} from './itinerary-core.mjs';
function straightLineKm(a,b){
  const coords=[a.latitude,a.longitude,b.latitude,b.longitude];
  if(!coords.every(Number.isFinite))return null;
  const radians=n=>n*Math.PI/180;
  const north=radians(b.latitude-a.latitude),east=radians(b.longitude-a.longitude);
  const latitudeA=radians(a.latitude),latitudeB=radians(b.latitude);
  const arc=Math.sin(north/2)**2+
    Math.cos(latitudeA)*Math.cos(latitudeB)*Math.sin(east/2)**2;
  // Earth's approximate mean radius. This is neither a travel route nor time.
  return Math.round((2*6371*Math.asin(Math.min(1,Math.sqrt(arc))))/10)*10;
}
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
    const distance=straightLineKm(previous[0],next[0]);
    const confirmed=Boolean(date)&&plan.bookings.some(b=>
      ['flight','transport'].includes(b.kind)&&b.status==='confirmed'&&
      Boolean(b.source_id)&&b.starts_on<=date&&b.ends_on>=date);
    // Only flag a material geographical change when both places have
    // member-entered coordinates. A source-linked transport anchor suppresses
    // this particular notice; it does not prove the journey is feasible.
    if(date&&distance!==null&&distance>=500&&!confirmed)
      notices.push({severity:'info',code:'long_distance_handover',
        description:'Day '+days[i].day+' changes overnight bases roughly '+
          distance+' km apart in a straight line.',
        evidence:{day:days[i].day,from_stop_id:previous[0].id,
          to_stop_id:next[0].id,straight_line_km:distance},
        action:'Check the intended travel mode and allow enough time. These are saved coordinates, not a route, travel duration, or supplier confirmation.'});
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
    limitations:'Only member-entered coordinates support straight-line distance notices. No current route duration, supplier availability, geographic feasibility or actual reservation status was checked.'};
}
