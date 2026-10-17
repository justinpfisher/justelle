// Small V1 vertical slice. It deliberately excludes map/research and legacy approvals.
import {sortAdventurePlans,itineraryDays} from './itinerary-core.mjs';
const $=id=>document.getElementById(id);
const el=(tag,className='',content='')=>{
  const node=document.createElement(tag);if(className)node.className=className;
  if(content)node.textContent=content;return node;
};
export function mountPlannerUI({planner,user,membership,onError,announce}){
  let plans=[],selected=null,stopped=false;
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
    for(const p of sortAdventurePlans(plans,today())){
      const card=el('article','record-card planner-card');
      const status=p.status==='archived'?'Archived':p.starts_on?p.starts_on+' · '+p.duration_days+' days':'Dates flexible';
      card.append(el('span','tag',status),el('h4','',p.title));
      const planned=p.stops.filter(s=>s.status==='planned').length,possible=p.stops.length-planned;
      card.append(el('p','meta',planned+' planned places · '+possible+' possibilities'));
      const open=el('button','secondary','Open plan');open.type='button';
      open.onclick=()=>{selected=p.id;render();void renderHistory();};
      card.append(open);list.append(card);
    }
    const p=plans.find(p=>p.id===selected);
    $('planner-detail').hidden=!p;
    if(!p)return;
    $('planner-detail-title').textContent=p.title;
    $('planner-summary').textContent=(p.starts_on||'Undated')+' · '+p.duration_days+
      ' days · Revision '+p.revision+' · Shared changes save immediately';
    $('planner-undo').disabled=p.revision===0;
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
      row.append(toggle,move);stays.append(row);
    }
    if(p.stops.length===0)stays.append(el('li','empty','No places added. Start with a possibility.'));
    $('planner-from').max=String(p.duration_days);
    $('planner-nights').max=String(p.duration_days);
  }
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
    }catch(error){onError(error);}
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
  const undo=()=>{const p=plans.find(x=>x.id===selected);if(p)void edit(p,{type:'undo_last'});};
  const close=()=>{selected=null;render();};
  $('planner-create').addEventListener('submit',created);
  $('planner-add-stay').addEventListener('submit',added);
  $('planner-undo').addEventListener('click',undo);
  $('planner-close').addEventListener('click',close);
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
    stopped=true;unsubscribe();
    $('planner-create').removeEventListener('submit',created);
    $('planner-add-stay').removeEventListener('submit',added);
    $('planner-undo').removeEventListener('click',undo);
    $('planner-close').removeEventListener('click',close);
    plans=[];selected=null;
  };
}
