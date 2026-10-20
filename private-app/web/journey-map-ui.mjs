// Accessible UI over canonical itinerary records. No tiles, external requests,
// or speculative lines. Opening Apple Maps requires a deliberate user click.
import {journeyMap} from './journey-map.mjs';
const element=(tag,cls='',text='')=>{
  const node=document.createElement(tag);
  if(cls)node.className=cls;
  if(text)node.textContent=text;
  return node;
};
export function paintJourneyMap(root,plan,day,selectedId,{onSelect,onBooking}){
  const model=journeyMap(plan,day),hadFocus=root.contains(document.activeElement);
  root.replaceChildren(element('h4','','Place locations'),
    element('p','meta','Relative positions only, not a navigational map or confirmed travel route. Dashed markers are possibilities.'));
  if(model.pins.length){
    const field=element('div','planner-map-field');
    field.setAttribute('role','group');
    field.setAttribute('aria-label','Approximate positions of saved places, without transport routes');
    field.append(element('span','planner-map-north','N ↑'));
    for(const [i,pin] of model.pins.entries()){
      const button=element('button','planner-map-pin',String(i+1));
      button.type='button';button.dataset.stopId=pin.id;button.dataset.state=pin.status;
      button.dataset.inDay=String(pin.on_day);
      button.style.left=pin.x_percent+'%';button.style.top=pin.y_percent+'%';
      button.setAttribute('aria-label','Select '+pin.title+' · '+pin.status);
      button.setAttribute('aria-pressed',String(selectedId===pin.id));
      button.onclick=()=>onSelect(model.places.find(p=>p.id===pin.id));
      field.append(button);
    }
    root.append(field);
  }else root.append(element('p','meta',
    'No locations pinned yet. Places remain available below; add coordinates in Edit details to show relative positions.'));
  const list=element('ul','planner-map-places');
  for(const place of model.places){
    const item=element('li','planner-map-place');
    const choice=element('button','secondary',place.title+' · '+place.status+
      ' · days '+place.from_day+'–'+(place.through_day-1));
    choice.type='button';choice.dataset.stopId=place.id;
    choice.dataset.inDay=String(place.on_day);
    choice.setAttribute('aria-pressed',String(selectedId===place.id));
    choice.onclick=()=>onSelect(place);
    item.append(choice);
    if(!Number.isFinite(place.latitude)||!Number.isFinite(place.longitude))
      item.append(element('span','meta',' Not pinned'));
    list.append(item);
  }
  root.append(list);
  if(!model.places.length)root.append(element('p','meta','Add a place to start shaping the journey.'));
  const place=model.places.find(p=>p.id===selectedId);
  if(place){
    const detail=element('section','planner-map-selected');
    detail.append(element('h4','',place.title),element('p','meta',
      (place.status==='planned'?'Planned overnight base':'Possible stop')+
      ' · days '+place.from_day+'–'+(place.through_day-1)));
    if(place.booking_mismatch)detail.append(element('p','planner-warning',
      'The saved plan and a confirmed booking have different dates. The outside reservation has not changed.'));
    for(const b of place.bookings){
      const label=b.status==='confirmed'?
        (b.source_id?'Member-recorded confirmation · source linked':'Member-recorded confirmation · original missing'):
        b.status==='cancelled'?'Cancelled booking · retained for reference':
        b.status==='voided'?'Voided booking · retained for reference':
        'Possible or unverified booking';
      detail.append(element('p','meta',label+' · '+b.summary));
      const link=element('button','text-button','Booking details · '+b.summary);
      link.type='button';link.onclick=()=>onBooking(b.id);
      detail.append(link);
    }
    if(Number.isFinite(place.latitude)&&Number.isFinite(place.longitude)){
      const link=element('a','text-button','Open location in Apple Maps');
      link.href='https://maps.apple.com/?ll='+place.latitude+','+place.longitude;
      link.target='_blank';link.rel='noopener noreferrer';
      detail.append(link,element('p','meta','Opening Apple Maps shares these coordinates with Apple.'));
    }
    root.append(detail);
  }
  if(hadFocus&&selectedId)
    [...root.querySelectorAll('button[data-stop-id]')].find(b=>b.dataset.stopId===selectedId)?.focus();
}
