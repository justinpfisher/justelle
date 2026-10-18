// Small V1 vertical slice. It deliberately excludes map/research and legacy approvals.
import {nextAdventures,journeyOverview,dayDetail,journeyWeeks} from './journey-view.mjs';
import {reviewAdventure} from './adventure-feedback.mjs';
import {todayEssentials} from './today-essentials.mjs';
import {mountBookingUI} from './booking-ui.mjs';
const $=id=>document.getElementById(id);
const el=(tag,className='',content='')=>{
  const node=document.createElement(tag);if(className)node.className=className;
  if(content)node.textContent=content;return node;
};
export function mountPlannerUI({planner,user,membership,onError,announce}){
  let plans=[],selected=null,selectedDay=null,stopped=false;
  const name=id=>{
    const uid=membership.uids.find(uid=>membership.people[uid]===id);
    return uid===user.uid?'You':membership.labels?.[uid]||'The other member';
  };
  function today(){
    // ICU locale date separators vary between browsers. Build an explicit ISO
    // date so the itinerary sort never crashes on an iPhone locale change.
    const parts=new Intl.DateTimeFormat('en-CA',{timeZone:'America/Toronto',
      year:'numeric',month:'2-digit',day:'2-digit'}).formatToParts(new Date());
    const byType=Object.fromEntries(parts.map(p=>[p.type,p.value]));
    return byType.year+'-'+byType.month+'-'+byType.day;
  }
  function render(){
    if(stopped)return;
    const list=$('planner-list');list.replaceChildren();
    if(!plans.length)list.append(el('p','empty','No shared adventures yet.'));
    const groups=nextAdventures(plans,today());
    for(const [title,items] of [['Upcoming & current',groups.current_and_upcoming],['Ideas without dates',groups.undated],['Earlier plans',groups.past],['Archive',groups.archived]]){
      if(!items.length)continue;
      list.append(el('h4','planner-group-heading',title));
      for(const p of items){
      const card=el('article','record-card planner-card');
      const status=p.status==='archived'?'Archived':p.starts_on?p.starts_on+' · '+p.duration_days+' days':'Dates flexible';
      card.append(el('span','tag',status),el('h4','',p.title));
      const planned=p.stops.filter(s=>s.status==='planned').length,possible=p.stops.length-planned;
      card.append(el('p','meta',planned+' planned places · '+possible+' possibilities'));
      const open=el('button','secondary','Open plan');open.type='button';
      open.onclick=()=>{if(selected!==p.id){selectedDay=null;closeStayEditor();closeExperienceEditor();}selected=p.id;render();void renderHistory();};
      card.append(open);list.append(card);
      }
    }
    const p=plans.find(p=>p.id===selected);
    $('planner-detail').hidden=!p;
    if(!p){closeStayEditor();closeExperienceEditor();selectedDay=null;void bookingUI.render(null);return;}
    void bookingUI.render(p);
    $('planner-detail-title').textContent=p.title;
    const tripForm=$('planner-trip-form');
    if(tripForm.dataset.planId!==p.id||tripForm.dataset.dirty!=='true'){
      $('planner-trip-title').value=p.title;
      $('planner-trip-date').value=p.starts_on||'';
      $('planner-trip-days').value=String(p.duration_days);
      tripForm.dataset.planId=p.id;
      tripForm.dataset.baseRevision=String(p.revision);
      tripForm.dataset.dirty='false';
    }
    $('planner-archive').textContent=p.status==='archived'?'Return to planning':'Move to archive';

    $('planner-summary').textContent=(p.starts_on||'Undated')+' · '+p.duration_days+
      ' days · Revision '+p.revision+' · Shared changes save immediately';
    $('planner-undo').disabled=p.revision===0;
    const stayForm=$('planner-edit-stay');
    if(!stayForm.hidden){
      if(stayForm.dataset.planId!==p.id||!p.stops.some(s=>s.id===stayForm.dataset.stopId))closeStayEditor();
      else $('planner-edit-status').textContent=Number(stayForm.dataset.baseRevision)!==p.revision?
        'The shared plan changed. Review the latest version before saving your draft.':
        'Editing the shared plan · Booking confirmations stay unchanged.';
    }
    const experienceForm=$('planner-edit-experience');
    if(!experienceForm.hidden){
      if(experienceForm.dataset.planId!==p.id||
         !(p.experiences??[]).some(e=>e.id===experienceForm.dataset.experienceId))
        closeExperienceEditor();
      else $('planner-experience-edit-status').textContent=
        Number(experienceForm.dataset.baseRevision)!==p.revision?
          'The shared plan changed. Review the latest version before saving your draft.':
          'Changing a planned experience does not change a supplier booking.';
    }
    $('planner-feedback-results').hidden=true;
    $('planner-today-result').hidden=true;
    const journey=journeyOverview(p),overview=$('planner-journey');
    overview.replaceChildren(el('p','meta',journey.open_nights.length+' nights without a planned base.'));
    for(const transfer of journey.transfers)
      overview.append(el('p','meta',(transfer.verified?'Source-linked confirmed':'Unverified')+' transfer · '+transfer.starts_on+' · '+transfer.summary));
    const alerts=$('planner-alerts');alerts.replaceChildren();
    for(const signal of journey.signals)
      alerts.append(el('p','planner-warning',signal.code.replaceAll('_',' ')+' · This has not changed an external reservation.'));
    if(selectedDay!==null&&selectedDay>p.duration_days)selectedDay=null;
    const days=$('planner-days-view');days.replaceChildren();
    for(const week of journeyWeeks(p)){
      const panel=el('details','planner-week');
      panel.dataset.fromDay=String(week.from_day);panel.dataset.toDay=String(week.to_day);
      panel.open=week.number===1||(selectedDay!==null&&week.from_day<=selectedDay&&selectedDay<=week.to_day);
      panel.append(el('summary','', 'Week '+week.number+' · Days '+week.from_day+'–'+week.to_day));
      const weekDays=el('div','planner-day-grid');
      for(const day of week.days){
      const button=el('button','secondary','Day '+day.day+(day.date?' · '+day.date:''));
      button.type='button';button.dataset.day=String(day.day);
      button.setAttribute('aria-pressed',String(selectedDay===day.day));
      button.onclick=()=>showDay(p,day.day);
      weekDays.append(button);
      }
      panel.append(weekDays);days.append(panel);
    }
    if(selectedDay!==null&&selectedDay<=p.duration_days)showDay(p,selectedDay);
    else $('planner-day-detail').replaceChildren(el('p','meta','Select a day to see planned places, possibilities and bookings.'));
    const experiences=$('planner-experiences');experiences.replaceChildren();
    for(const e of (p.experiences??[]).slice().sort((a,b)=>a.day-b.day||a.id.localeCompare(b.id))){
      const row=el('li','planner-stay');
      row.append(el('strong','',e.title),
        el('p','meta','Day '+e.day+' · '+e.status+(e.notes?' · '+e.notes:'')));
      const viewDay=el('button','text-button','Show day '+e.day);
      viewDay.type='button';viewDay.onclick=()=>revealDay(p,e.day);
      const editButton=el('button','text-button','Edit experience');
      editButton.type='button';editButton.onclick=()=>openExperienceEditor(p,e);
      row.append(viewDay,editButton);experiences.append(row);
    }
    if(!(p.experiences??[]).length)
      experiences.append(el('li','empty','No day experiences recorded yet.'));
    $('planner-experience-day').max=String(p.duration_days);
    $('planner-experience-edit-day').max=String(p.duration_days);
    const stays=$('planner-stays');stays.replaceChildren();
    for(const s of p.stops.slice().sort((a,b)=>a.from_day-b.from_day)){
      const row=el('li','planner-stay');
      const nights=s.through_day-s.from_day;
      row.append(el('strong','',s.title),el('p','meta','Days '+s.from_day+'–'+
        (s.through_day-1)+' · '+nights+' night'+(nights===1?'':'s')+' · '+s.status));
      const toggle=el('button','text-button',s.status==='possible'?'Mark planned':'Keep as possible');
      toggle.type='button';toggle.onclick=()=>void edit(p,{type:'edit_stop',id:s.id,
        patch:{status:s.status==='possible'?'planned':'possible'}});
      const move=el('button','text-button','Move one day later');
      move.type='button';move.disabled=s.through_day>p.duration_days;
      move.onclick=()=>void edit(p,{type:'edit_stop',id:s.id,
        patch:{from_day:s.from_day+1,through_day:s.through_day+1}});
      const change=el('button','text-button','Edit details');
      change.type='button';change.onclick=()=>openStayEditor(p,s);
      const viewDay=el('button','text-button','Show day '+s.from_day);
      viewDay.type='button';viewDay.onclick=()=>revealDay(p,s.from_day);
      row.append(toggle,move,change,viewDay);
      for(const booking of p.bookings.filter(b=>b.stop_id===s.id)){
        const link=el('button','text-button','Booking: '+booking.summary);
        link.type='button';link.onclick=()=>void bookingUI.openBooking(booking.id);
        row.append(link);
      }
      stays.append(row);
    }
    if(p.stops.length===0)stays.append(el('li','empty','No places added. Start with a possibility.'));
    $('planner-from').max=String(p.duration_days);
    $('planner-nights').max=String(p.duration_days);
  }
  function showDay(p,day){
    const detail=dayDetail(p,day),out=$('planner-day-detail');
    selectedDay=day;
    $('planner-experience-day').value=String(day);
    for(const b of document.querySelectorAll('#planner-days-view button[data-day]'))
      b.setAttribute('aria-pressed',String(Number(b.dataset.day)===day));
    out.replaceChildren(el('h4','','Day '+day+(detail.date?' · '+detail.date:'')),
      el('p','',detail.planned.map(x=>x.title).join(', ')||'No planned overnight base'),
      el('p','meta',detail.possibilities.map(x=>x.title).join(', ')||'No alternative stops'));
    for(const experience of detail.experiences??[])
      out.append(el('p','meta',(experience.status==='planned'?'Planned':'Possible')+
        ' experience · '+experience.title+(experience.notes?' · '+experience.notes:'')));
    for(const booking of detail.bookings){
      const link=el('button','text-button','View booking · '+booking.summary);
      link.type='button';link.onclick=()=>void bookingUI.openBooking(booking.id);
      out.append(el('p','meta',booking.status+' · '+booking.summary),link);
    }
  }
  function revealDay(p,day){
    $('planner-days-view').closest('details').open=true;
    for(const panel of document.querySelectorAll('#planner-days-view .planner-week'))
      if(Number(panel.dataset.fromDay)<=day&&day<=Number(panel.dataset.toDay))panel.open=true;
    showDay(p,day);
    $('planner-experience-day').value=String(day);
    $('planner-day-detail').scrollIntoView({block:'nearest'});
  }
  function closeStayEditor(){
    const form=$('planner-edit-stay');form.hidden=true;delete form.dataset.planId;
    delete form.dataset.stopId;delete form.dataset.baseRevision;
  }
  function openStayEditor(p,stop){
    const form=$('planner-edit-stay');
    form.dataset.planId=p.id;form.dataset.stopId=stop.id;
    form.dataset.baseRevision=String(p.revision);
    $('planner-edit-title').value=stop.title;
    $('planner-edit-from').value=String(stop.from_day);
    $('planner-edit-nights').value=String(stop.through_day-stop.from_day);
    $('planner-edit-state').value=stop.status;
    $('planner-edit-from').max=String(p.duration_days);
    $('planner-edit-nights').max=String(p.duration_days);
    $('planner-edit-status').textContent='Editing '+stop.title+' · revision '+p.revision;
    form.hidden=false;
    form.scrollIntoView({block:'nearest'});
  }
  const refreshStay=()=>{
    const form=$('planner-edit-stay'),p=plans.find(x=>x.id===selected);
    const stop=p?.stops.find(s=>s.id===form.dataset.stopId);
    if(!stop)return closeStayEditor();
    openStayEditor(p,stop);
  };
  const saveStay=async event=>{
    event.preventDefault();
    const form=$('planner-edit-stay'),p=plans.find(x=>x.id===selected);
    const stop=p?.stops.find(s=>s.id===form.dataset.stopId);
    if(!stop||form.dataset.planId!==p.id)return onError(Error('Choose a current place to edit.'));
    if(Number(form.dataset.baseRevision)!==p.revision)
      return onError(Error('The shared plan changed while you were editing. Review the latest version before saving.'));
    const from=Number($('planner-edit-from').value),nights=Number($('planner-edit-nights').value);
    if(!Number.isInteger(from)||!Number.isInteger(nights)||from<1||nights<1||
       from+nights>p.duration_days+1)
      return onError(Error('The stay must fit within the current adventure days.'));
    const patch={title:$('planner-edit-title').value.trim(),from_day:from,
      through_day:from+nights,status:$('planner-edit-state').value};
    const button=form.querySelector('[type=submit]');button.disabled=true;
    try{
      if(await edit(p,{type:'edit_stop',id:stop.id,patch}))closeStayEditor();
    }finally{button.disabled=false;}
  };
  function closeExperienceEditor(){
    const form=$('planner-edit-experience');form.hidden=true;
    delete form.dataset.planId;delete form.dataset.experienceId;delete form.dataset.baseRevision;
  }
  function openExperienceEditor(p,experience){
    const form=$('planner-edit-experience');
    form.dataset.planId=p.id;form.dataset.experienceId=experience.id;
    form.dataset.baseRevision=String(p.revision);
    $('planner-experience-edit-title').value=experience.title;
    $('planner-experience-edit-day').value=String(experience.day);
    $('planner-experience-edit-state').value=experience.status;
    $('planner-experience-edit-notes').value=experience.notes;
    $('planner-experience-edit-status').textContent='Editing day '+experience.day+' · revision '+p.revision;
    form.hidden=false;form.scrollIntoView({block:'nearest'});
  }
  const refreshExperience=()=>{
    const form=$('planner-edit-experience'),p=plans.find(x=>x.id===selected);
    const experience=(p?.experiences??[]).find(e=>e.id===form.dataset.experienceId);
    if(!experience)return closeExperienceEditor();
    openExperienceEditor(p,experience);
  };
  const saveExperience=async event=>{
    event.preventDefault();
    const form=$('planner-edit-experience'),p=plans.find(x=>x.id===selected);
    const experience=(p?.experiences??[]).find(e=>e.id===form.dataset.experienceId);
    if(!p||!experience||form.dataset.planId!==p.id)
      return onError(Error('Choose a current experience to edit.'));
    if(Number(form.dataset.baseRevision)!==p.revision)
      return onError(Error('The shared plan changed while you were editing. Review the latest version before saving.'));
    const patch={title:$('planner-experience-edit-title').value.trim(),
      day:Number($('planner-experience-edit-day').value),
      status:$('planner-experience-edit-state').value,
      notes:$('planner-experience-edit-notes').value.trim()};
    const button=form.querySelector('[type=submit]');button.disabled=true;
    try{
      if(await edit(p,{type:'edit_experience',id:experience.id,patch}))closeExperienceEditor();
    }finally{button.disabled=false;}
  };
  const addedExperience=async event=>{
    event.preventDefault();
    const p=plans.find(x=>x.id===selected);if(!p)return;
    const experience={id:crypto.randomUUID(),title:$('planner-experience-title').value.trim(),
      day:Number($('planner-experience-day').value),status:$('planner-experience-state').value,
      notes:$('planner-experience-notes').value.trim()};
    const form=$('planner-add-experience'),button=form.querySelector('[type=submit]');
    button.disabled=true;
    try{
      if(await edit(p,{type:'add_experience',experience})){
        $('planner-experience-title').value='';
        $('planner-experience-notes').value='';
      }
    }finally{button.disabled=false;}
  };
  async function renderHistory(){
    if(!selected||stopped)return;
    try{
      const id=selected,events=await planner.readHistory(id);
      if(id!==selected||stopped)return;
      const out=$('planner-history');out.replaceChildren();
      for(const e of events.slice().reverse()){
        const when=e.created_at?.toDate?.()?.toLocaleString('en-CA',
          {dateStyle:'medium',timeStyle:'short',timeZone:'America/Toronto'})||'Saving…';
        out.append(el('li','',e.operation.replaceAll('_',' ')+' · '+name(e.actor_id)+' · '+when));
      }
    }catch(error){onError(error);}
  }
  async function edit(p,change){
    try{
      await planner.editPlan(user,p.id,change,p.revision);
      announce('Saved for both of you. Undo remains available.');
      await renderHistory();
      return true;
    }catch(error){onError(error);return false;}
  }
  const created=async event=>{
    event.preventDefault();try{
      const form=$('planner-create'),button=form.querySelector('button[type=submit]');
      button.disabled=true;
      try{
        const id=await planner.createPlan(user,{title:$('planner-title').value,
          durationDays:Number($('planner-days').value),startsOn:$('planner-date').value||null});
        selected=id;$('planner-title').value='';$('planner-date').value='';
        announce('Adventure added to our shared plans.');
      }finally{button.disabled=false;}
    }catch(error){onError(error);}
  };
  const added=async event=>{
    event.preventDefault();
    const p=plans.find(x=>x.id===selected);
    if(!p)return;
    const start=Number($('planner-from').value),nights=Number($('planner-nights').value);
    const title=$('planner-stay-title').value.trim();
    if(!Number.isInteger(start)||!Number.isInteger(nights)||nights<1)return onError(Error('Check the days and nights.'));
    await edit(p,{type:'add_stop',stop:{id:crypto.randomUUID(),place_id:crypto.randomUUID(),
      title,from_day:start,through_day:start+nights,status:$('planner-state').value}});
    $('planner-stay-title').value='';
  };
  const feedback=()=>{
    const p=plans.find(x=>x.id===selected);if(!p)return;
    const result=reviewAdventure(p),out=$('planner-feedback-results');
    out.replaceChildren(el('p','meta','Saved revision '+result.revision+'. '+result.limitations));
    for(const note of result.notices){
      const item=el('div','planner-warning');
      item.append(el('strong','',note.description),el('p','meta',note.action));
      out.append(item);
    }
    if(!result.notices.length)out.append(el('p','', 'No saved-record conflicts detected; no live supplier or route checks were performed.'));
    out.hidden=false;
  };
  const showToday=()=>{
    const p=plans.find(x=>x.id===selected);if(!p)return;
    const d=todayEssentials(p,today()),out=$('planner-today-result');
    out.replaceChildren(el('h4','',"Today's essentials"));
    if(!d.in_trip)out.append(el('p','', 'No scheduled day in this adventure today.'));
    else{
      out.append(el('p','', 'Day '+d.day+' · '+d.date));
      out.append(el('p','meta','Overnight base: '+(d.overnight?.title||'Not yet planned')));
      for(const record of d.bookings)out.append(el('p','', 'Recorded booking: '+record.summary));
      for(const record of d.uncertain)out.append(el('p','meta','Unverified: '+record.summary));
      if(d.tomorrow)out.append(el('p','meta','Tomorrow: '+(d.tomorrow.planned_places.join(', ')||'No planned base')));
      out.append(el('p','meta',d.limitations));
    }
    out.hidden=false;
  };
  const tripDirty=()=>{$('planner-trip-form').dataset.dirty='true';};
  const saveTrip=async event=>{
    event.preventDefault();
    const p=plans.find(x=>x.id===selected);if(!p)return;
    const form=$('planner-trip-form');
    if(Number(form.dataset.baseRevision)!==p.revision)
      return onError(Error('Your shared plan changed while you were editing. Review the new version before saving.'));
    const patch={title:$('planner-trip-title').value.trim(),
      starts_on:$('planner-trip-date').value||null,
      duration_days:Number($('planner-trip-days').value)};
    const button=form.querySelector('[type=submit]');button.disabled=true;
    try{
      await planner.editPlan(user,p.id,{type:'edit_trip',patch},p.revision);
      form.dataset.dirty='false';
      announce('Trip details saved for both of you. Undo is available.');
    }catch(error){onError(error);}finally{button.disabled=false;}
  };
  const refreshTrip=()=>{$('planner-trip-form').dataset.dirty='false';render();};
  const archive=()=>{
    const p=plans.find(x=>x.id===selected);if(!p)return;
    void edit(p,{type:'set_status',status:p.status==='archived'?'planning':'archived'});
  };
  const undo=()=>{const p=plans.find(x=>x.id===selected);if(p)void edit(p,{type:'undo_last'});};
  const close=()=>{selected=null;selectedDay=null;closeStayEditor();closeExperienceEditor();render();};
  $('planner-create').addEventListener('submit',created);
  $('planner-trip-form').addEventListener('input',tripDirty);
  $('planner-trip-form').addEventListener('submit',saveTrip);
  $('planner-archive').addEventListener('click',archive);
  $('planner-trip-refresh').addEventListener('click',refreshTrip);
  $('planner-add-stay').addEventListener('submit',added);
  $('planner-edit-stay').addEventListener('submit',saveStay);
  $('planner-edit-refresh').addEventListener('click',refreshStay);
  $('planner-edit-cancel').addEventListener('click',closeStayEditor);
  $('planner-add-experience').addEventListener('submit',addedExperience);
  $('planner-edit-experience').addEventListener('submit',saveExperience);
  $('planner-experience-refresh').addEventListener('click',refreshExperience);
  $('planner-experience-cancel').addEventListener('click',closeExperienceEditor);
  $('planner-undo').addEventListener('click',undo);
  $('planner-feedback').addEventListener('click',feedback);
  $('planner-today').addEventListener('click',showToday);
  $('planner-close').addEventListener('click',close);
  const bookingUI=mountBookingUI({planner,user,getPlan:()=>plans.find(x=>x.id===selected),onError,announce});
  const unsubscribe=planner.subscribePlans(rows=>{
    const previousRevision=plans.find(p=>p.id===selected)?.revision;
    plans=rows;
    if(!stopped){
      render();
      const currentRevision=plans.find(p=>p.id===selected)?.revision;
      if(selected&&currentRevision!==undefined&&currentRevision!==previousRevision)
        void renderHistory();
    }
  },onError);
  return ()=>{
    stopped=true;unsubscribe();bookingUI.dispose();
    $('planner-create').removeEventListener('submit',created);
    $('planner-trip-form').removeEventListener('input',tripDirty);
    $('planner-trip-form').removeEventListener('submit',saveTrip);
    $('planner-archive').removeEventListener('click',archive);
    $('planner-trip-refresh').removeEventListener('click',refreshTrip);
    $('planner-add-stay').removeEventListener('submit',added);
    $('planner-edit-stay').removeEventListener('submit',saveStay);
    $('planner-edit-refresh').removeEventListener('click',refreshStay);
    $('planner-edit-cancel').removeEventListener('click',closeStayEditor);
    $('planner-add-experience').removeEventListener('submit',addedExperience);
    $('planner-edit-experience').removeEventListener('submit',saveExperience);
    $('planner-experience-refresh').removeEventListener('click',refreshExperience);
    $('planner-experience-cancel').removeEventListener('click',closeExperienceEditor);
    $('planner-undo').removeEventListener('click',undo);
    $('planner-feedback').removeEventListener('click',feedback);
    $('planner-today').removeEventListener('click',showToday);
    $('planner-close').removeEventListener('click',close);
    plans=[];selected=null;
  };
}
