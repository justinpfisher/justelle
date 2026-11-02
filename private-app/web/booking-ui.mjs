// Private booking UI: source records stay separate from mutable itinerary.
import {sha256} from './media.mjs';
import {bookingStatusText} from './journey-view.mjs';
import {extractBookingDraft} from './booking-extraction.mjs';
import {createOfflineDocumentCache,isConfirmedAccessDenied,isConfirmedOffline} from './offline-document-cache.mjs';
const $=id=>document.getElementById(id);
const node=(tag,cls='',value='')=>{
  const n=document.createElement(tag);if(cls)n.className=cls;if(value)n.textContent=value;return n;
};
export function mountBookingUI({planner,user,getPlan,onError,announce,offlineCacheScope=null,isSessionCurrent=()=>true}){
  let stopped=false,request=0,sourceRequest=0,originalRequest=0,pdfRequest=0;
  let pdfController=null,pdfPlanId=null,pdfSaving=false,pdfFormRevision=0;
  const offlineCache=offlineCacheScope?createOfflineDocumentCache({scope:offlineCacheScope,
    isCurrent:()=>!stopped&&isSessionCurrent()}):null;
  if(offlineCache)void offlineCache.activate().catch(()=>{});
  const reportError=(error,current=()=>!stopped)=>{
    if(!current())return;
    if(isConfirmedAccessDenied(error))void offlineCache?.close().catch(()=>{});
    onError(error);
  };
  const pdfButton=()=>$('planner-booking-pdf-extract');
  pdfButton().disabled=false;
  const invalidatePdf=()=>{
    pdfRequest++;
    const controller=pdfController;
    pdfController=null;pdfPlanId=null;
    controller?.abort();
    const button=pdfButton();if(button)button.disabled=stopped||pdfSaving;
  };
  const onPdfFormReset=()=>{pdfFormRevision++;invalidatePdf();};
  const onPdfFileChange=()=>{pdfFormRevision++;invalidatePdf();};
  const onPdfFieldEdit=()=>{pdfFormRevision++;invalidatePdf();};
  const onBookingsPanelToggle=()=>{if(!$('planner-bookings-panel').open)invalidatePdf();};
  function downloadOriginal(bytes,mime,name){
    const url=URL.createObjectURL(new Blob([bytes],{type:mime}));
    const a=node('a');a.href=url;a.download=name||'justelle-original';
    document.body.append(a);a.click();a.remove();setTimeout(()=>URL.revokeObjectURL(url),15000);
  }
  const savedLabel=saved=>'Saved on this device '+new Date(saved.savedAt).toLocaleString('en-CA',{
    dateStyle:'medium',timeStyle:'short',timeZone:'America/Toronto'})+' from plan revision '+saved.revision+
    '. It may be out of date and is not encrypted by the app. Protect this browser profile; signing out clears it. Opening it after a cold start still requires normal sign-in and membership checks.';
  const checksumLabel=saved=>'SHA-256 verified: '+saved.sha256;
  async function renderOfflineFallback(booking,isCurrent){
    if(!offlineCache||!isCurrent())return false;
    const saved=await offlineCache.getBooking(booking.id);
    if(!saved||!isCurrent())return false;
    const out=$('planner-booking-source');out.replaceChildren();
    out.append(node('h4','','Saved booking details (may be out of date)'));
    out.append(node('p','',saved.summary));
    if(saved.sourceTitle)out.append(node('p','meta','Source: '+saved.sourceTitle));
    if(saved.sourceSupplier)out.append(node('p','meta','Supplier: '+saved.sourceSupplier));
    out.append(node('p','meta',saved.kind+' · '+saved.startsOn+' to '+saved.endsOn+
      ' · '+bookingStatusText(saved.status)));
    if(saved.stopName)out.append(node('p','meta','Planned place: '+saved.stopName));
    out.append(node('p','planner-warning',savedLabel(saved)));
    if(saved.documentId){
      const cached=await offlineCache.getDocument(saved.documentId);
      if(!isCurrent())return true;
      if(cached){
        const open=node('button','secondary','Open saved original on this device');open.type='button';
        open.onclick=async()=>{
          try{const current=await offlineCache.getDocument(saved.documentId);if(isCurrent()&&current)downloadOriginal(current.bytes,current.mime,current.name);}
          catch(error){reportError(error,isCurrent);}
        };
        out.append(open);
        out.append(node('p','meta',checksumLabel(cached)));
        const remove=node('button','text-button','Remove saved original from this device');remove.type='button';
        remove.onclick=async()=>{try{await offlineCache.removeDocument(saved.documentId);if(isCurrent())remove.remove();}
          catch(error){reportError(error,isCurrent);}};
        out.append(remove);
      }else out.append(node('p','meta','The original confirmation was not separately saved offline.'));
    }
    const removeBooking=node('button','text-button','Remove saved booking details from this device');
    removeBooking.type='button';removeBooking.onclick=async()=>{
      try{await offlineCache.removeBooking(booking.id);if(isCurrent())out.replaceChildren(node('p','meta','Offline copy removed.'));}
      catch(error){reportError(error,isCurrent);}
    };
    out.append(removeBooking);return true;
  }
  async function appendOfflineControls(out,booking,source,isCurrent){
    if(!offlineCache)return;
    if(!globalThis.indexedDB){out.append(node('p','meta','This browser does not support private offline copies.'));return;}
    const p=getPlan();if(!p)return;
    const status=node('p','meta');out.append(status);
    const bookingButtons=node('div','planner-offline-actions');
    const saveBooking=node('button','secondary','Save booking details for offline on this device');
    saveBooking.type='button';bookingButtons.append(saveBooking);out.append(bookingButtons);
    const updateBookingStatus=async()=>{
      try{const saved=await offlineCache.getBooking(booking.id);if(isCurrent()){
        status.textContent=saved?savedLabel(saved):'Booking details are not saved offline.';
        saveBooking.textContent=saved?'Update offline booking details':'Save booking details for offline on this device';
      }}catch{if(isCurrent())status.textContent='Private offline storage is unavailable in this browser.';}
    };
    saveBooking.onclick=async()=>{
      saveBooking.disabled=true;
      try{
        const currentPlan=getPlan();if(!isCurrent()||!currentPlan||currentPlan.id!==booking.adventure_id)return;
        const stopName=currentPlan.stops.find(s=>s.id===booking.stop_id)?.title||null;
        const saved=await offlineCache.saveBooking({id:booking.id,adventureId:currentPlan.id,
          documentId:source?.document_id||null,summary:booking.summary,kind:booking.kind,
          startsOn:booking.starts_on,endsOn:booking.ends_on,status:booking.status,
          sourceTitle:source?.title||null,sourceSupplier:source?.supplier||null,stopName,
          revision:currentPlan.revision});
        if(isCurrent())status.textContent=savedLabel(saved);
      }catch(error){reportError(error,isCurrent);}
      finally{if(isCurrent())saveBooking.disabled=false;}
    };
    await updateBookingStatus();if(!isCurrent())return;
    if(!source?.document_id)return;
    const originalStatus=node('p','meta','The original confirmation is not saved offline.');out.append(originalStatus);
    const originalButtons=node('div','planner-offline-actions');
    const saveOriginal=node('button','secondary','Save original confirmation for offline on this device');
    saveOriginal.type='button';originalButtons.append(saveOriginal);out.append(originalButtons);
    const openSaved=node('button','text-button','Open saved original on this device');openSaved.type='button';
    const removeSaved=node('button','text-button','Remove saved original from this device');removeSaved.type='button';
    const updateOriginalStatus=async()=>{
      try{const saved=await offlineCache.getDocument(source.document_id);if(!isCurrent())return;
        originalStatus.textContent=saved?savedLabel(saved):'The original confirmation is not saved offline.';
        if(saved)originalStatus.textContent+=' '+checksumLabel(saved);
        openSaved.hidden=!saved;removeSaved.hidden=!saved;
      }catch{if(isCurrent())originalStatus.textContent='Private offline storage is unavailable in this browser.';}
    };
    saveOriginal.onclick=async()=>{
      saveOriginal.disabled=true;
      try{
        const currentPlan=getPlan();if(!isCurrent()||!currentPlan||currentPlan.id!==booking.adventure_id)return;
        const documents=await planner.readDocuments(currentPlan.id);if(!isCurrent())return;
        const d=documents.find(x=>x.id===source.document_id);if(!d)throw Error('The original document cannot be found');
        const bytes=await planner.documentBytes(d.id);if(!isCurrent())return;
        if(bytes.byteLength!==d.size||await sha256(bytes)!==d.sha256)throw Error('Original document failed its integrity check');
        const saved=await offlineCache.saveDocument({id:d.id,name:d.name,mime:d.mime,size:d.size,
          sha256:d.sha256,bytes,revision:currentPlan.revision});
        if(isCurrent()){originalStatus.textContent=savedLabel(saved)+' '+checksumLabel(saved);openSaved.hidden=false;removeSaved.hidden=false;}
      }catch(error){reportError(error,isCurrent);}
      finally{if(isCurrent())saveOriginal.disabled=false;}
    };
    openSaved.onclick=async()=>{
      try{const saved=await offlineCache.getDocument(source.document_id);if(isCurrent()&&saved)downloadOriginal(saved.bytes,saved.mime,saved.name);}
      catch(error){reportError(error,isCurrent);}
    };
    removeSaved.onclick=async()=>{
      try{await offlineCache.removeDocument(source.document_id);if(isCurrent())await updateOriginalStatus();}
      catch(error){reportError(error,isCurrent);}
    };
    originalButtons.append(openSaved,removeSaved);await updateOriginalStatus();
  }
  async function openSource(booking,source,isCurrent){
    if(stopped||!isCurrent())return;
    const out=$('planner-booking-source');out.replaceChildren();
    if(!source)out.append(node('p','planner-warning','Original source not available; this is not independently verified.'));
    else{
      out.append(node('h4','',source.title));
      if(source.supplier)out.append(node('p','meta','Supplier: '+source.supplier));
      if(source.reference)out.append(node('p','meta','Reference recorded by a member: '+source.reference));
      if(source.notes)out.append(node('p','meta',source.notes));
      out.append(node('p','meta','Editing the plan does not alter the supplier booking.'));
    }
    if(source?.document_id){
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
          downloadOriginal(bytes,d.mime,d.name);
        }catch(error){reportError(error,current);}
        finally{if(current())button.disabled=false;}
      };
      out.append(button);
    }
    await appendOfflineControls(out,booking,source,isCurrent);
  }
  async function render(plan){
    if(pdfController&&(!plan||pdfPlanId!==plan.id))invalidatePdf();
    if(!pdfController)pdfButton().disabled=stopped||pdfSaving;
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
    catch(error){reportError(error,()=>!stopped&&ticket===request);return;}
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
    }catch(error){
      if(!isCurrent())return;
      if(isConfirmedAccessDenied(error)){reportError(error,isCurrent);return;}
      if(isConfirmedOffline(error,globalThis.navigator?.onLine!==false)&&
        await renderOfflineFallback(booking,isCurrent))return;
      reportError(error,isCurrent);
    }
  }
  const applyDraftText=(text,sourceLabel='')=>{
    const feedback=$('planner-booking-extraction-feedback');
    try{
      const result=extractBookingDraft(text);
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
        if(field==='kind'){
          if(target.value==='stay'||target.value===value){target.value=value;filled++;}
          else notes.push('Kept your chosen booking type; review the wording.');
        }else if(!target.value){target.value=value;filled++;}
        else if(target.value!==value)notes.push('Kept your existing '+names[field]+'; check it against the original.');
      }
      feedback.textContent=(sourceLabel?sourceLabel+' ':'')+filled+' field'+(filled===1?'':'s')+
        ' filled for review. '+result.limitations+(notes.length?' '+notes.join(' '):'');
    }catch(error){feedback.textContent=error.message||'Could not extract booking details.';}
  };
  const extract=()=>{invalidatePdf();applyDraftText($('planner-booking-paste').value);};
  const extractPdf=async()=>{
    const feedback=$('planner-booking-extraction-feedback');
    if(pdfSaving||stopped)return;
    const fileInput=$('planner-booking-file'),file=fileInput.files?.[0];
    const button=$('planner-booking-pdf-extract');
    invalidatePdf();
    const ticket=pdfRequest,planId=getPlan()?.id,formRevision=pdfFormRevision;
    const controller=new AbortController();pdfController=controller;pdfPlanId=planId;
    const current=()=>!stopped&&ticket===pdfRequest&&pdfController===controller&&
      !controller.signal.aborted&&$('planner-bookings-panel').open&&
      getPlan()?.id===planId&&fileInput.files?.[0]===file&&
      pdfFormRevision===formRevision;
    if(!file||file.type!=='application/pdf'&&!file.name.toLowerCase().endsWith('.pdf')){
      feedback.textContent='Choose a PDF file to read selectable text.';return;
    }
    if(file.size>12*1024*1024){feedback.textContent='Choose a PDF that is 12 MiB or smaller.';return;}
    button.disabled=true;
    try{
      const bytes=new Uint8Array(await file.arrayBuffer());
      if(!current())return;
      const {extractPdfBookingText}=await import('./pdfjs-booking-extraction.mjs');
      if(!current())return;
      const result=await extractPdfBookingText(bytes,{signal:controller.signal});
      if(!current())return;
      if(!result.text){feedback.textContent='No selectable text was found. Scanned pages need manual entry; OCR is not used.';return;}
      applyDraftText(result.text,'PDF text read locally; '+result.pages+' page'+(result.pages===1?'':'s')+'.');
    }catch(error){if(current())feedback.textContent=error.message||'Could not read selectable PDF text.';}
    finally{
      if(pdfController===controller){pdfController=null;pdfPlanId=null;button.disabled=stopped||pdfSaving;}
    }
  };
  const submit=async e=>{
    e.preventDefault();const p=getPlan();if(stopped||!p)return;
    invalidatePdf();pdfSaving=true;$('planner-booking-pdf-extract').disabled=true;
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
    }catch(error){reportError(error);}
    finally{
      pdfSaving=false;
      if(!stopped){button.disabled=false;$('planner-booking-pdf-extract').disabled=false;}
    }
  };
  const form=$('planner-add-booking'),fileInput=$('planner-booking-file'),panel=$('planner-bookings-panel');
  const pdfFields=['planner-booking-kind','planner-booking-title','planner-booking-supplier',
    'planner-booking-reference','planner-booking-start','planner-booking-end','planner-booking-stop',
    'planner-booking-paste'];
  form.addEventListener('reset',onPdfFormReset);
  fileInput.addEventListener('change',onPdfFileChange);
  for(const id of pdfFields){$(id).addEventListener('input',onPdfFieldEdit);$(id).addEventListener('change',onPdfFieldEdit);}
  panel.addEventListener('toggle',onBookingsPanelToggle);
  $('planner-booking-extract').addEventListener('click',extract);
  $('planner-booking-pdf-extract').addEventListener('click',extractPdf);
  $('planner-add-booking').addEventListener('submit',submit);
  return {render,openBooking,dispose(){
    stopped=true;request++;sourceRequest++;originalRequest++;
    void offlineCache?.close().catch(()=>{});
    invalidatePdf();
    form.removeEventListener('reset',onPdfFormReset);
    fileInput.removeEventListener('change',onPdfFileChange);
    for(const id of pdfFields){$(id).removeEventListener('input',onPdfFieldEdit);$(id).removeEventListener('change',onPdfFieldEdit);}
    panel.removeEventListener('toggle',onBookingsPanelToggle);
    $('planner-booking-extract').removeEventListener('click',extract);
    $('planner-booking-pdf-extract').removeEventListener('click',extractPdf);
    $('planner-add-booking').removeEventListener('submit',submit);
  }};
}
