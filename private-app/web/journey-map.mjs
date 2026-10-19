// Only saved, member-entered coordinates become map pins. This is a
// provider-neutral relative-position view, never a verified transport route.
import {journeyOverview} from './journey-view.mjs';
export function journeyMap(plan,selectedDay=null){
  const journey=journeyOverview(plan);
  const places=journey.stays.map(s=>({
    id:s.id,title:s.title,status:s.status,from_day:s.from_day,through_day:s.through_day,
    latitude:s.latitude,longitude:s.longitude,
    on_day:selectedDay!==null&&s.from_day<=selectedDay&&selectedDay<s.through_day,
    bookings:journey.bookings.filter(b=>b.stop_id===s.id),
    booking_mismatch:journey.signals.some(v=>v.stop_id===s.id&&v.code==='booking_plan_mismatch')
  }));
  const plotted=places.filter(p=>Number.isFinite(p.latitude)&&Number.isFinite(p.longitude))
    .map(p=>({...p,x:p.longitude,y:180/Math.PI*Math.log(Math.tan(
      Math.PI/4+Math.max(-85,Math.min(85,p.latitude))*Math.PI/360))}));
  if(!plotted.length)return {places,pins:[]};
  const x0=Math.min(...plotted.map(p=>p.x)),x1=Math.max(...plotted.map(p=>p.x));
  const y0=Math.min(...plotted.map(p=>p.y)),y1=Math.max(...plotted.map(p=>p.y));
  const extent=Math.max(x1-x0,y1-y0,0.05);
  const pins=plotted.map(p=>({id:p.id,title:p.title,status:p.status,on_day:p.on_day,
    x_percent:50+70*(p.x-(x0+x1)/2)/extent,
    y_percent:50-70*(p.y-(y0+y1)/2)/extent}));
  return {places,pins};
}
