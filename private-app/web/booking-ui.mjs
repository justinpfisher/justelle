// Private booking UI: source records stay separate from mutable itinerary.
import {sha256} from './media.mjs';
const $=id=>document.getElementById(id);
const node=(tag,cls='',value='')=>{
  const n=document.createElement(tag);if(cls)n.className=cls;if(value)n.textContent=value;return n;
};
export function mountBookingUI({planner,user,getPlan,onError,announce}){
  let stopped=false,request=0;
  async function openSource(booking,source){
    const out=$('planner-booking-source');out.replaceChildren();
    if(!source){out.append(node('p','planner-warning','Original source not available; this is not independently verified.'));return;}
    out.append(node('h4','',source.title));
    if(source.supplier)out.append(node('p','meta','Supplier: '+source.supplier));
    if(source.reference)out.append(node('p','meta','Reference recorded by a member: '+source.reference));
    if(source.notes)out.append(node('p','meta',source.notes));
    out.append(node('p','meta','Editing the plan does not alter the supplier booking.'));
    if(!source.document_id)return;
    const button=node('button','secondary','Open protected original');button.type='button';
    button.onclick=async()=>{
      button.disabled=true;
      try{
        const p=getPlan();if(!p||p.id!==booking.adventure_id)return;
        const d=(await planner.readDocuments(p.id)).find(x=>x.id===source.document_id);
        if(!d)throw Error('The original document cannot be found');
        const bytes=await planner.documentBytes(d.id);
        if(bytes.byteLength!==d.size||await sha256(bytes)!==d.sha256)
          throw Error('Original document failed its integrity check');
        const url=URL.createObjectURL(new Blob([bytes],{type:d.mime}));
        const a=node('a');a.href=url;a.download=d.name||'justelle-original';
        document.body.append(a);a.click();a.remove();setTimeout(()=>URL.revokeObjectURL(url),15000);
      }catch(error){onError(error);}
      finally{button.disabled=false;}
    };
    out.append(button);
  }
  async function render(plan){
    const ticket=++request,root=$('planner-bookings');root.replaceChildren();
    $('planner-booking-source').replaceChildren();
    if(!plan)return;
    if(!plan.bookings.length)root.append(node('li','empty','No saved booking details yet.'));
    let sources=[];
    try{sources=await planner.readSources(plan.id);}
    catch(error){if(!stopped&&ticket===request)onError(error);return;}
    if(stopped||ticket!==request)return;
    const map=new Map(sources.map(s=>[s.id,s]));
    for(const b of plan.bookings){
      const li=node('li','planner-booking-entry');
      li.append(node('strong','',b.summary));
      li.append(node('p','meta',b.kind+' · '+b.starts_on+' to '+b.ends_on+
        ' · '+(b.status==='confirmed'?'Member-recorded confirmation':'Not confirmed')));
      const view=node('button','text-button',b.source_id?'Show original details':'No source attached');
      view.type='button';view.disabled=!b.source_id;
      view.onclick=()=>void openSource({...b,adventure_id:plan.id},map.get(b.source_id));
      li.append(view);root.append(li);
    }
  }
  const submit=async e=>{
    e.preventDefault();const p=getPlan();if(!p)return;
    const button=$('planner-add-booking').querySelector('[type=submit]');button.disabled=true;
    try{
      const title=$('planner-booking-title').value.trim();
      const starts=$('planner-booking-start').value,ends=$('planner-booking-end').value;
      const kind=$('planner-booking-kind').value,status=$('planner-booking-state').value;
      if(kind==='stay'&&starts>=ends)throw Error('Hotel checkout must follow check-in');
      if(starts>ends)throw Error('Booking end cannot precede start');
      const file=$('planner-booking-file').files?.[0]||null;
      const documentId=file?await planner.addDocument(user,{adventureId:p.id,file}):null;
      const sourceId=await planner.addSource(user,{adventureId:p.id,kind:'booking',title,
        supplier:$('planner-booking-supplier').value,reference:$('planner-booking-reference').value,
        documentId});
      await planner.editPlan(user,p.id,{type:'add_booking',booking:{
        id:crypto.randomUUID(),kind,stop_id:null,starts_on:starts,ends_on:ends,
        status,source_id:sourceId,summary:title
      }},p.revision);
      $('planner-add-booking').reset();
      announce('Booking details saved. The supplier reservation was not changed.');
    }catch(error){onError(error);}
    finally{button.disabled=false;}
  };
  $('planner-add-booking').addEventListener('submit',submit);
  return {render,dispose(){stopped=true;request++;$('planner-add-booking').removeEventListener('submit',submit);}};
}
