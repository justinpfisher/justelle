// Private booking UI: source records stay separate from mutable itinerary.
import {sha256} from './media.mjs';
import {bookingStatusText} from './journey-view.mjs';
import {extractBookingDraft} from './booking-extraction.mjs';
const $=id=>document.getElementById(id);
const node=(tag,cls='',value='')=>{
  const n=document.createElement(tag);if(cls)n.className=cls;if(value)n.textContent=value;return n;
};
export function mountBookingUI({planner,user,getPlan,onError,announce}){
  let stopped=false,request=0,sourceRequest=0,originalRequest=0;
  async function openSource(booking,source,isCurrent){
    if(stopped||!isCurrent())return;
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
      const ticket=++originalRequest;
      const current=()=>!stopped&&ticket===originalRequest&&isCurrent();
      button.disabled=true;
      try{
        if(!current())return;
        const p=getPlan();if(!p||p.id!==booking.adventure_id)return;
        const documents=await planner.readDocuments(p.id);
        if(!current())return;
        const d=documents.find(x=>x.id===source.document_id);
        if(!d)throw Error('The original document cannot be found');
        const bytes=await planner.documentBytes(d.id);
        if(!current())return;
        if(bytes.byteLength!==d.size)throw Error('Original document failed its integrity check');
        const digest=await sha256(bytes);
        if(!current())return;
        if(digest!==d.sha256)throw Error('Original document failed its integrity check');
        const url=URL.createObjectURL(new Blob([bytes],{type:d.mime}));
        const a=node('a');a.href=url;a.download=d.name||'justelle-original';
        document.body.append(a);a.click();a.remove();setTimeout(()=>URL.revokeObjectURL(url),15000);
      }catch(error){if(current())onError(error);}
      finally{if(current())button.disabled=false;}
    };
    out.append(button);
  }
  async function render(plan){
    const ticket=++request,root=$('planner-bookings');root.replaceChildren();
    $('planner-booking-source').replaceChildren();
    const related=$('planner-booking-stop'),previous=related.value;
    related.replaceChildren(new Option('No specific place',''));
    if(!plan)return;
    for(const stop of plan.stops.slice().sort((a,b)=>a.from_day-b.from_day))
      related.add(new Option(stop.title+' · day '+stop.from_day,stop.id));
    if([...related.options].some(x=>x.value===previous))related.value=previous;
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
        ' · '+bookingStatusText(b.status)));
      const view=node('button','text-button',b.source_id?'Show original details':'No source attached');
      view.type='button';view.disabled=!b.source_id;
      view.onclick=()=>void openBooking(b.id);
      li.append(view);root.append(li);
    }
  }
  async function openBooking(bookingId){
    const plan=getPlan(),booking=plan?.bookings.find(b=>b.id===bookingId);
    if(stopped||!plan||!booking)return;
    const ticket=++sourceRequest;
    const isCurrent=()=>!stopped&&ticket===sourceRequest&&getPlan()?.id===plan.id;
    $('planner-booking-source').replaceChildren();
    $('planner-bookings-panel').open=true;
    try{
      const sources=await planner.readSources(plan.id);
      if(!isCurrent())return;
      await openSource({...booking,adventure_id:plan.id},
        sources.find(source=>source.id===booking.source_id),isCurrent);
      if(!isCurrent())return;
      $('planner-booking-source').scrollIntoView({block:'nearest'});
    }catch(error){if(isCurrent())onError(error);}
  }
  const extract=()=>{
    const feedback=$('planner-booking-extraction-feedback');
    try{
      const result=extractBookingDraft($('planner-booking-paste').value);
      const mapping={kind:'planner-booking-kind',summary:'planner-booking-title',
        supplier:'planner-booking-supplier',reference:'planner-booking-reference',
        starts_on:'planner-booking-start',ends_on:'planner-booking-end'};
      const names={kind:'booking type',summary:'booking title',supplier:'supplier',
        reference:'reference',starts_on:'start date',ends_on:'end date'};
      const notes=[...result.warnings];
      let filled=0;
      for(const [field,id] of Object.entries(mapping)){
        const value=result.fields[field];if(!value)continue;
        const target=$(id);
        // Preserve deliberate member-entered details unless the form is still
        // at its untouched default kind; never overwrite an existing date.
        if(field==='kind'){
          if(target.value==='stay'||target.value===value){
            target.value=value;filled++;
          }else notes.push('Kept your chosen booking type; review the pasted wording.');
        }else if(!target.value){
          target.value=value;filled++;
        }else if(target.value!==value){
          notes.push('Kept your existing '+names[field]+'; check it against the original.');
        }
      }
      feedback.textContent=filled+' field'+(filled===1?'':'s')+
        ' filled for review. '+result.limitations+
        (notes.length?' '+notes.join(' '):'');
    }catch(error){feedback.textContent=error.message||'Could not read the pasted booking.';}
  };
  const submit=async e=>{
    e.preventDefault();const p=getPlan();if(stopped||!p)return;
    const button=$('planner-add-booking').querySelector('[type=submit]');button.disabled=true;
    try{
      const title=$('planner-booking-title').value.trim();
      const starts=$('planner-booking-start').value,ends=$('planner-booking-end').value;
      const kind=$('planner-booking-kind').value,status=$('planner-booking-state').value;
      if(kind==='stay'&&starts>=ends)throw Error('Hotel checkout must follow check-in');
      if(starts>ends)throw Error('Booking end cannot precede start');
      const file=$('planner-booking-file').files?.[0]||null;
      const originalText=$('planner-booking-paste').value;
      if(originalText.length>4000)throw Error('Original booking text exceeds 4,000 characters');
      if(status==='confirmed'&&!file&&!originalText.trim()&&
         !$('planner-booking-reference').value.trim())
        throw Error('Add an original document, pasted confirmation or booking reference before marking this as confirmed. Otherwise keep it possible or unverified.');
      const documentId=file?await planner.addDocument(user,{adventureId:p.id,file}):null;
      if(stopped)return;
      const sourceId=await planner.addSource(user,{adventureId:p.id,kind:'booking',title,
        notes:originalText,
        supplier:$('planner-booking-supplier').value,reference:$('planner-booking-reference').value,
        documentId});
      if(stopped)return;
      await planner.editPlan(user,p.id,{type:'add_booking',booking:{
        id:crypto.randomUUID(),kind,stop_id:$('planner-booking-stop').value||null,
        starts_on:starts,ends_on:ends,
        status,source_id:sourceId,summary:title
      }},p.revision);
      if(stopped)return;
      $('planner-add-booking').reset();
      $('planner-booking-extraction-feedback').textContent=
        'You can also save the original text without extraction. Extracted fields are suggestions only; review before saving.';
      announce('Booking details and original text saved privately. The supplier reservation was not changed.');
    }catch(error){if(!stopped)onError(error);}
    finally{if(!stopped)button.disabled=false;}
  };
  $('planner-booking-extract').addEventListener('click',extract);
  $('planner-add-booking').addEventListener('submit',submit);
  return {render,openBooking,dispose(){
    stopped=true;request++;sourceRequest++;originalRequest++;
    $('planner-booking-extract').removeEventListener('click',extract);
    $('planner-add-booking').removeEventListener('submit',submit);
  }};
}
