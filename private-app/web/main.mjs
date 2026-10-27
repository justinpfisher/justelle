import {initializeApp} from 'firebase/app';
import {getAuth,connectAuthEmulator,setPersistence,browserLocalPersistence,signInWithEmailAndPassword,signOut,onAuthStateChanged,getIdTokenResult} from 'firebase/auth';
import {getFirestore,connectFirestoreEmulator,doc,getDoc} from 'firebase/firestore';
import {getStorage,connectStorageEmulator} from 'firebase/storage';
import {resolveRuntime} from './runtime-config.mjs';
import {protectedMediaTransport} from './protected-media.mjs';
import {firebaseBackend} from './firebase-backend.mjs';
import {mountPlannerUI} from './planner-ui.mjs';
import {prepareImage,revokePrepared} from './media.mjs';
import {GENERAL_CONVERSATION,contextFor,decisionView} from './topics.mjs';

const runtime=resolveRuntime({hostname:location.hostname,origin:location.origin,env:import.meta.env});
const {projectId,roomId}=runtime;
const historicalReadOnly=runtime.mode==='production';
// A query-gated hook exists only for fictional localhost browser regressions.
// It delays UI completion after a real emulator write has already completed.
const testSessionRaces=runtime.mode==='local'&&
  new URLSearchParams(location.search).get('test-session-races')==='1'?
  (window.__justelleTestSessionRaces={
    currentPlanner:null,gates:{},
    installEditGate(name){
      if(!['old','new'].includes(name))throw Error('Unknown fictional edit gate');
      const planner=this.currentPlanner;
      if(!planner||typeof planner.editPlan!=='function')throw Error('Local planner is not ready');
      const original=planner.editPlan.bind(planner);
      let release;
      const wait=new Promise(resolve=>{release=resolve;});
      const gate={committed:false,release};
      this.gates[name]=gate;
      planner.editPlan=async(...args)=>{
        const result=await original(...args);
        gate.committed=true;
        await wait;
        return result;
      };
    }
  }):null;
const app=initializeApp(runtime.firebase);
const auth=getAuth(app),db=getFirestore(app),storage=getStorage(app);
if(runtime.mode==='local'){
  connectAuthEmulator(auth,'http://'+location.hostname+':9099',{disableWarnings:true});
  connectFirestoreEmulator(db,location.hostname,8081);
  connectStorageEmulator(storage,location.hostname,9199);
}
await setPersistence(auth,browserLocalPersistence);

const $=id=>document.getElementById(id);
if(runtime.mode!=='production'){
  const banner=document.querySelector('.pilot');
  banner.textContent=runtime.mode==='hosted-fictional'?
    'Fictional qualification · Personal content is not enabled':
    'Local fictional-data pilot · Not connected to the public website';
  banner.hidden=false;
  document.querySelector('#login > p').textContent=runtime.mode==='hosted-fictional'?
    'Use the dedicated fictional qualification account. Do not enter personal information.':
    'Sign in with a fictional account created by the local emulator. This prototype is not authorised for personal content.';
  document.querySelector('label[for=email]').textContent='Test email';
  document.querySelector('label[for=password]').textContent='Test password';
}
if(runtime.mode==='production'){
  document.querySelector('.pilot').hidden=true;
  document.querySelector('#login > p').textContent='Sign in once on your own device. Justelle usually remembers you when you reopen it.';
  document.querySelector('label[for=email]').textContent='Email';
  document.querySelector('label[for=password]').textContent='Password';
  document.querySelector('.export-area p').textContent='Download our conversations, original images and agreements. This download is unencrypted; keep it somewhere private.';
  $('export-button').textContent='Download our history';
  document.querySelector('footer').textContent='Our private shared space';
  document.getElementById('idea-form').hidden=true;
  document.getElementById('proposal-form').hidden=true;
  document.querySelector('#agreements-tab .intro').textContent=
    'These are earlier suggestions and agreements. They stay in our history; current adventures update directly when either of you edits a plan.';
}
const GENERAL_TITLE='Our chat';
let correctionId=null;
const drafts=new Map(),sendAttempts=new Map();
let backend=null,unsubscribers=[],stopTopic=()=>{},stopPlanner=()=>{},pending=[],sending=false;
let records={adventures:[],decisions:[],messages:[]};
let selectedAdventure=null,currentConversation=GENERAL_CONVERSATION,latest=[],older=[],before=null,hasOlder=false;
let authSessionVersion=0,topicVersion=0,loadingOlder=false,startedTopic=false,selectedSourceMessage=null,replacesId=null;
let attachments=new Map(),loadingAttachments=new Set(),mediaUrls=new Map();
const setNotice=text=>$('notice').textContent=text||'';
const clearError=()=>{$('error').textContent='';};
function error(e){
  $('error').textContent=e?.message||String(e)||'Something went wrong';setNotice('');
  if(e?.code==='permission-denied'||e?.code==='storage/unauthorized'){
    invalidatePrivateSession();
    void signOut(auth).catch(()=>{});
  }
}
function element(tag,cls,text){
  const node=document.createElement(tag);
  if(cls)node.className=cls;
  if(text!==undefined)node.textContent=text;
  return node;
}
function stamp(time){
  try{return time?.toDate?.()?.toLocaleString('en-CA',{
    month:'short',day:'numeric',hour:'numeric',minute:'2-digit',timeZone:'America/Toronto'
  })||'Saving…';}
  catch{return 'Saving…';}
}
function labels(){return backend?.membership?.labels||{};}
function authorName(id){
  if(id==='ai-mock')return 'Justelle (demo)';
  if(id==='ai-justelle')return 'Justelle AI';
  const uid=backend?.membership?.uids?.find(u=>backend.person({uid:u})===id);
  return uid===auth.currentUser?.uid?'You':(labels()[uid]||'The other person');
}
function isCurrentAuthSession(version,uid){
  return version===authSessionVersion&&Boolean(uid)&&auth.currentUser?.uid===uid;
}
function tab(name){
  const previous=document.querySelector('[data-tab].selected')?.dataset.tab;
  if(previous&&previous!==name)setNotice('');
  for(const b of document.querySelectorAll('[data-tab]')){
    const active=b.dataset.tab===name;
    b.classList.toggle('selected',active);
    if(active)b.setAttribute('aria-current','page');else b.removeAttribute('aria-current');
  }
  $('conversation-tab').hidden=name!=='conversation';
  $('adventures-tab').hidden=name!=='adventures';
}
document.querySelectorAll('[data-tab]').forEach(b=>b.addEventListener('click',()=>tab(b.dataset.tab)));
function topicName(id=selectedAdventure){
  return id?(records.adventures.find(a=>a.id===id)?.title||'Adventure discussion'):GENERAL_TITLE;
}
function sortedMessages(){
  const merged=new Map([...older,...latest].map(m=>[m.id,m]));
  return [...merged.values()].sort((a,b)=>
    (a.created_at?.toMillis?.()||0)-(b.created_at?.toMillis?.()||0)||a.id.localeCompare(b.id));
}
function isNearLatest(){
  const el=$('timeline-scroll');
  return el.scrollHeight-el.scrollTop-el.clientHeight<100;
}
function scrollToLatest(){
  const el=$('timeline-scroll');
  el.scrollTop=el.scrollHeight;
  $('jump-latest').hidden=true;
}
$('close-image').onclick=()=>{$('image-viewer').close();$('full-image').removeAttribute('src');};
$('image-viewer').addEventListener('click',event=>{if(event.target===$('image-viewer'))$('close-image').click();});
$('jump-latest').onclick=scrollToLatest;
$('timeline-scroll').addEventListener('scroll',()=>{
  $('jump-latest').hidden=isNearLatest();
});
function renderTopics(){
  const root=$('topic-list'),general=element('button','topic-chip'+(!selectedAdventure?' selected':''),GENERAL_TITLE);
  general.type='button';general.dataset.topicId=GENERAL_CONVERSATION;
  general.setAttribute('aria-pressed',String(!selectedAdventure));
  general.onclick=()=>selectTopic(null);
  root.replaceChildren(general);
  const list=records.adventures.slice().sort((a,b)=>
    (b.updated_at?.toMillis?.()||0)-(a.updated_at?.toMillis?.()||0));
  for(const a of list){
    const active=selectedAdventure===a.id;
    const btn=element('button','topic-chip'+(active?' selected':''),a.title);
    btn.type='button';btn.dataset.topicId=a.conversation_id;
    btn.title=a.title;btn.setAttribute('aria-pressed',String(active));
    btn.onclick=()=>selectTopic(a.id);
    root.append(btn);
  }
}
async function renderSourceNote(version){
  const source=$('topic-source-note'),topic=records.adventures.find(a=>a.id===selectedAdventure);
  source.hidden=true;source.replaceChildren();
  if(!topic?.source_message_id)return;
  const sourceId=topic.source_message_id;
  try{
    const original=await backend.messageById(sourceId);
    if(version!==topicVersion||!original)return;
    source.append(document.createTextNode('Started in our chat: “'+(original.body||'An image').slice(0,130)+'” '));
    const link=element('button','text-button','Return to our chat');
    link.type='button';link.onclick=()=>selectTopic(null);
    source.append(link);source.hidden=false;
  }catch(e){if(version===topicVersion)error(e);}
}
function renderTopicHeading(){
  const a=records.adventures.find(x=>x.id===selectedAdventure);
  $('topic-title').textContent=topicName();
  $('topic-eyebrow').textContent=a?'An adventure we share':'Our shared space';
  $('topic-subtitle').textContent=a
    ?'A home for this idea, our conversation, images and plans. Exploring it does not mean we have agreed.'
    :"For everyday thoughts and questions. Start an adventure whenever an idea deserves its own space.";
  renderTopics();
}
function selectTopic(adventureId=null,{preserveTab=false}={}){
  if(adventureId!==null && !records.adventures.some(a=>a.id===adventureId)){
    // Just-created records may arrive through Firestore after the write resolves.
    // The deterministic conversation identifier is still safe to subscribe to.
    if(typeof adventureId!=='string')return;
  }
  drafts.set(currentConversation,{body:$('message-input').value,correctionId,pending});
  const scope=contextFor(adventureId);
  const draft=drafts.get(scope.conversationId);
  $('message-input').value=draft?.body||'';correctionId=draft?.correctionId||null;pending=draft?.pending||[];refreshPending();
  $('correction-note').hidden=!correctionId;
  selectedAdventure=scope.adventureId;currentConversation=scope.conversationId;
  try{localStorage.setItem('justelle-last-topic:'+auth.currentUser.uid,adventureId||'');}catch{}
  stopTopic();stopTopic=()=>{};topicVersion++;
  latest=[];older=[];before=null;hasOlder=false;startedTopic=false;loadingOlder=false;
  for(const url of mediaUrls.values())URL.revokeObjectURL(url);
  mediaUrls.clear();attachments.clear();loadingAttachments.clear();
  selectedSourceMessage=null;replacesId=null;clearProposal();
  closePlans();renderTopicHeading();renderDecisions();renderMessages();
  $('topic-source-note').hidden=true;
  void renderSourceNote(topicVersion);
  const version=topicVersion;
  const session=authSessionVersion,uid=auth.currentUser?.uid;
  const sessionError=e=>{if(isCurrentAuthSession(session,uid))error(e);};
  stopTopic=backend.subscription('messages',payload=>{
    if(version!==topicVersion)return;
    const keepScroll=startedTopic&&!isNearLatest();
    latest=payload.items;before=older.length?before:payload.cursor;
    hasOlder=older.length?hasOlder:payload.hasMore;
    renderMessages();
    if(!keepScroll)requestAnimationFrame(scrollToLatest);
    startedTopic=true;
  },sessionError,scope.conversationId);
  if(!preserveTab)tab('conversation');
}
function previewImage(slot,metadata,session=authSessionVersion,uid=auth.currentUser?.uid){
  slot.replaceChildren();
  const path=metadata.preview_path||metadata.original_path;
  const img=element('img','image-tile');
  img.alt='Attached image: '+metadata.name;
  img.loading='lazy';
  if(mediaUrls.has(path))img.src=mediaUrls.get(path);
  else (async()=>{
    try{
      const bytes=await backend.imageBytes(path);
      const url=URL.createObjectURL(new Blob([bytes],{type:metadata.preview_path?'image/jpeg':metadata.mime}));
      if(!isCurrentAuthSession(session,uid)||!backend||!slot.isConnected){URL.revokeObjectURL(url);return;}
      mediaUrls.set(path,url);img.src=url;
    }catch(e){
      if(isCurrentAuthSession(session,uid)&&slot.isConnected)
        img.replaceWith(element('p','media-note','Image preview unavailable. '+e.message));
    }
  })();
  const expand=element('button','image-preview-button');expand.type='button';expand.setAttribute('aria-label','Enlarge '+metadata.name);expand.append(img);
  expand.onclick=()=>{
    if(!isCurrentAuthSession(session,uid)||!img.src)return;
    $('full-image').src=img.src;$('full-image').alt=img.alt;
    $('image-caption').textContent=metadata.name;$('image-viewer').showModal();
  };
  slot.append(expand);
  const download=element('button','text-button','Open original');
  download.type='button';download.onclick=async()=>{
    const requestSession=authSessionVersion,requestUid=auth.currentUser?.uid;
    try{
      const bytes=await backend.imageBytes(metadata.original_path);
      if(!isCurrentAuthSession(requestSession,requestUid))return;
      const url=URL.createObjectURL(new Blob([bytes],{type:metadata.mime}));
      const a=document.createElement('a');a.href=url;a.download=metadata.name||'justelle-image';a.click();
      setTimeout(()=>URL.revokeObjectURL(url),5000);
    }catch(e){if(isCurrentAuthSession(requestSession,requestUid))error(e);}
  };
  slot.append(download);
}
async function fetchAttachment(id,version){
  if(loadingAttachments.has(id)||attachments.has(id))return;
  const session=authSessionVersion,uid=auth.currentUser?.uid;
  loadingAttachments.add(id);
  try{
    const metadata=await backend.getAttachment(id);
    if(version!==topicVersion||!isCurrentAuthSession(session,uid))return;
    if(!metadata)throw Error('Image record is missing');
    attachments.set(id,metadata);
    for(const slot of document.querySelectorAll('[data-attachment-id="'+id+'"]'))
      previewImage(slot,metadata,session,uid);
  }catch(e){
    if(version===topicVersion&&isCurrentAuthSession(session,uid))
      for(const slot of document.querySelectorAll('[data-attachment-id="'+id+'"]'))
        slot.textContent='Image unavailable: '+e.message;
  }finally{
    if(isCurrentAuthSession(session,uid))loadingAttachments.delete(id);
  }
}
function renderMessages(){
  if(!backend||!auth.currentUser)return;
  const scroll=$('timeline-scroll'),wasBottom=isNearLatest(),oldTop=scroll.scrollTop;
  const root=$('messages'),messages=sortedMessages();
  root.replaceChildren();
  $('conversation-empty').hidden=messages.length>0;
  for(const message of messages){
    const bubble=element('li','bubble'+(message.kind==='ai'?' ai':
      message.author_id===backend.person(auth.currentUser)?' self':''));
    bubble.dataset.messageId=message.id;
    const who=element('div','who');
    who.append(element('span',null,authorName(message.author_id)),element('time',null,stamp(message.created_at)));
    bubble.append(who);
    if(message.corrects_id)bubble.append(element('p','meta','A correction to an earlier message. The original is kept.'));
    if(message.body)bubble.append(element('p',null,message.body));
    for(const id of message.attachment_ids||[]){
      const slot=element('div','attachment-slot','Opening attached image…');
      slot.dataset.attachmentId=id;bubble.append(slot);
      if(attachments.has(id))previewImage(slot,attachments.get(id));
      else void fetchAttachment(id,topicVersion);
    }
    if(message.kind==='person'){
      const actions=element('div','message-actions');
      const ask=element('button',null,'Ask Justelle');
      ask.type='button';ask.onclick=()=>requestAI(message.id);
      const save=element('button',null,'Start an adventure');
      save.type='button';save.onclick=async()=>{
        clearError();
        const session=authSessionVersion,owner=auth.currentUser,activeBackend=backend;
        const isCurrent=()=>Boolean(owner)&&isCurrentAuthSession(session,owner.uid);
        if(!owner||!activeBackend)return;
        try{
          const title=(message.body.trim()||'Explore an image').slice(0,160);
          if(historicalReadOnly){
            await activeBackend.planner.createPlan(owner,{title});
            if(!isCurrent())return;
            tab('adventures');
            setNotice('Saved as a new adventure. You can add places and dates in the shared plan.');
          }else{
            const id=await activeBackend.addIdea(owner,{title,sourceMessageId:message.id});
            if(!isCurrent())return;
            setNotice('We’ve saved an adventure for this idea.');selectTopic(id);
          }
        }catch(e){if(isCurrent())error(e);}
      };
      const propose=element('button',null,'Suggest a plan');
      propose.type='button';propose.onclick=()=>{
        selectedSourceMessage=message.id;replacesId=null;
        $('proposal-input').value=message.body.trim().slice(0,4000);
        $('reason-input').value='';$('revision-context').hidden=true;
        $('cancel-revision').hidden=false;openPlans();
        $('proposal-input').focus();
      };
      actions.append(ask,save);
      if(!historicalReadOnly)actions.append(propose);
      if(message.author_id===backend.person(auth.currentUser)){
        const correct=element('button',null,'Add a correction');correct.type='button';
        correct.onclick=()=>{correctionId=message.id;$('correction-note').hidden=false;$('message-input').focus();};
        actions.append(correct);
      }
      bubble.append(actions);
    }
    root.append(bubble);
  }
  $('earlier-button').hidden=!hasOlder;
  if(wasBottom && startedTopic)requestAnimationFrame(scrollToLatest);
  else scroll.scrollTop=oldTop;
}
$('earlier-button').addEventListener('click',async()=>{
  if(loadingOlder||!before||!hasOlder)return;
  const version=topicVersion,session=authSessionVersion,uid=auth.currentUser?.uid,scroll=$('timeline-scroll');
  const isCurrent=()=>version===topicVersion&&isCurrentAuthSession(session,uid);
  loadingOlder=true;$('earlier-button').disabled=true;
  const oldHeight=scroll.scrollHeight,oldTop=scroll.scrollTop;
  try{
    const page=await backend.readPage(currentConversation,before);
    if(!isCurrent())return;
    const seen=new Set([...older,...latest].map(x=>x.id));
    older.push(...page.items.filter(x=>!seen.has(x.id)));
    before=page.cursor;hasOlder=page.hasMore;
    renderMessages();
    requestAnimationFrame(()=>{if(isCurrent())scroll.scrollTop=oldTop+(scroll.scrollHeight-oldHeight);});
  }catch(e){if(isCurrent())error(e);}
  finally{if(isCurrent()){loadingOlder=false;$('earlier-button').disabled=false;}}
});
function decisionWording(d,extra={}){
  const me=auth.currentUser.uid,other=backend.membership.uids.find(uid=>uid!==me);
  const otherName=labels()[other]||'the other person';
  if(d.stale)return {tag:'Earlier suggestion',message:'We have since agreed to a different change. Use our current plan to suggest something new.'};
  if(d.status==='declined')return {tag:'Not for us',message:(d.declined_by===backend.person(auth.currentUser)?'You':authorName(d.declined_by))+' passed on this suggestion. We can always try another idea.'};
  if(d.status==='locked'&&extra.superseded_by?.length)return {
    tag:'An earlier plan',message:'We agreed to change this. The original stays in our history.'
  };
  if(d.status==='locked')return {tag:'We both said yes',message:'This is something we agreed on together.'};
  if(d.approvals?.[me])return {tag:'Still deciding',message:'You said yes. Waiting for '+otherName+' to weigh in.'};
  if(d.approvals?.[other])return {tag:'Still deciding',message:otherName+' said yes. What do you think?'};
  return {tag:'Just a suggestion',message:'Nothing is settled yet. We can each say yes when we’re ready.'};
}
function renderDecisionCard(d){
  const card=element('article','record-card');card.dataset.decisionId=d.id;
  const wording=decisionWording(d,d);
  card.append(element('span','tag'+(d.status==='locked'?' locked':d.status==='declined'?' declined':''),wording.tag));
  card.append(element('h3',null,d.body));
  card.append(element('p','meta','Suggested by '+authorName(d.author_id)+' · '+stamp(d.created_at)));
  card.append(element('p','decision-summary',wording.message));
  if(d.conflict)card.append(element('p','context','More than one change was agreed to. We should clarify which version we mean.'));
  for(const uid of backend.membership.uids){
    if(d.approvals?.[uid]){
      const name=uid===auth.currentUser.uid?'You':(labels()[uid]||'The other person');
      card.append(element('p','meta agreement-history',name+' said yes · '+stamp(d.approval_times?.[uid])));
    }
  }
  if(d.why)card.append(element('p','context',d.why));
  if(d.replaces_id){
    const old=records.decisions.find(x=>x.id===d.replaces_id);
    card.append(element('p','context','A change to '+(old?'“'+old.body.slice(0,140)+'”':'an earlier plan')+
      '. Our previous agreement stays until we both say yes to a change.'));
  }
  const actions=element('div','actions');
  if(!historicalReadOnly&&d.status==='proposed'&&!d.stale){
    const voted=Boolean(d.approvals?.[auth.currentUser.uid]);
    const agree=element('button',voted?'secondary':'primary',voted?'You said yes':'Yes, I agree');
    agree.type='button';agree.disabled=voted;
    agree.onclick=async()=>{
      clearError();try{await backend.approve(auth.currentUser,d.id);setNotice('You said yes. This becomes our plan once we both agree.');}
      catch(e){error(e);}
    };
    const decline=element('button','secondary','Not for me');
    decline.type='button';decline.onclick=async()=>{
      clearError();try{await backend.decline(auth.currentUser,d.id);setNotice('You passed on that suggestion. Nothing was erased.');}
      catch(e){error(e);}
    };
    actions.append(agree,decline);
  }else if(!historicalReadOnly&&d.status==='locked'&&!d.superseded_by?.length){
    const revise=element('button','secondary','Suggest a change');
    revise.type='button';revise.onclick=()=>{
      replacesId=d.id;selectedSourceMessage=null;
      $('proposal-input').value=d.body;$('reason-input').value='';
      $('revision-context').textContent='The plan we already agreed on stays in place until we both say yes to a change.';
      $('revision-context').hidden=false;$('cancel-revision').hidden=false;
      $('proposal-input').focus();$('proposal-form').scrollIntoView({block:'nearest'});
    };
    actions.append(revise);
  }
  card.append(actions);return card;
}
function renderDecisions(){
  if(!backend)return;
  const view=decisionView(records.decisions,currentConversation);
  const count=view.unresolved.length+view.current.length+view.history.length;
  $('plans-toggle').textContent=historicalReadOnly?
    (count?'Past suggestions ('+count+')':'Past suggestions'):(count?'Our plans ('+count+')':'Our plans');
  const preview=$('plans-preview');
  preview.replaceChildren();preview.hidden=true;
  if(view.current.length||view.unresolved.length){
    const summary=view.current.length
      ?'We agreed: '+view.current.map(x=>x.body).join('; ').slice(0,135)
      :view.unresolved.length+' suggestion'+(view.unresolved.length===1?'':'s')+' still to discuss.';
    preview.append(element('span',null,summary));
    const btn=element('button','text-button',historicalReadOnly?'View past agreements':'See our plans');btn.type='button';btn.onclick=openPlans;
    preview.append(btn);preview.hidden=false;
  }
  const root=$('decisions');root.replaceChildren();
  if(view.hasConflict)root.append(element('p','context','We agreed to different changes to an earlier plan. We should review them together.'));
  for(const d of [...view.unresolved,...view.current])root.append(renderDecisionCard(d));
  if(view.history.length){
    const history=element('details','history-list');
    const heading=element('summary',null,'Earlier suggestions and plans ('+view.history.length+')');
    history.append(heading);
    for(const d of view.history)history.append(renderDecisionCard(d));
    root.append(history);
  }
  $('decisions-empty').hidden=count>0;
}
function openPlans(){
  $('agreements-tab').hidden=false;$('plans-toggle').setAttribute('aria-expanded','true');
  $('plans-toggle').textContent=historicalReadOnly?'Close history':'Close plans';
}
function closePlans(){
  $('agreements-tab').hidden=true;$('plans-toggle').setAttribute('aria-expanded','false');
}
$('plans-toggle').onclick=()=>{
  if($('agreements-tab').hidden)openPlans();else closePlans();
};
$('close-plans').onclick=closePlans;
function clearProposal(){
  replacesId=null;selectedSourceMessage=null;
  $('proposal-input').value='';$('reason-input').value='';
  $('revision-context').hidden=true;$('cancel-revision').hidden=true;
}
$('cancel-revision').onclick=clearProposal;
$('proposal-form').addEventListener('submit',async e=>{
  e.preventDefault();clearError();
  try{
    await backend.propose(auth.currentUser,{
      body:$('proposal-input').value,why:$('reason-input').value,
      replacesId,sourceMessageId:selectedSourceMessage,adventureId:selectedAdventure
    });
    clearProposal();setNotice('It’s a suggestion for now. We’ll decide together.');
  }catch(e){error(e);}
});
function renderAdventures(){
  if(!backend)return;
  const root=$('adventures');root.replaceChildren();
  $('adventures-empty').hidden=records.adventures.length>0;
  const phaseLabels={idea:'Exploring',plan:'Working on it',experience:'Happened',memory:'Remembering'};
  const nextLabels={idea:'Start planning',plan:'Mark as happened',experience:'Save as a memory'};
  const adventures=records.adventures.slice().sort((a,b)=>
    (b.updated_at?.toMillis?.()||0)-(a.updated_at?.toMillis?.()||0));
  for(const a of adventures){
    const card=element('article','record-card');card.dataset.adventureId=a.id;
    card.append(element('span','tag',phaseLabels[a.phase]||a.phase));
    card.append(element('h3',null,a.title));
    const plans=decisionView(records.decisions,a.conversation_id);
    const status=plans.current.length?plans.current.length+' plan'+(plans.current.length===1?'':'s')+' agreed':
      plans.unresolved.length?plans.unresolved.length+' suggestion'+(plans.unresolved.length===1?'':'s')+' to discuss':'No plan agreed yet';
    card.append(element('p','meta',status+' · Started by '+authorName(a.author_id)));
    card.append(element('p','context','Each adventure has its own conversation and keeps its original messages and images.'));
    const actions=element('div','actions');
    const discuss=element('button','primary','Open discussion');discuss.type='button';
    discuss.onclick=()=>selectTopic(a.id);
    actions.append(discuss);
    const phaseIndex=['idea','plan','experience','memory'].indexOf(a.phase);
    if(!historicalReadOnly&&phaseIndex>=0&&phaseIndex<3){
      const advance=element('button','secondary',nextLabels[a.phase]);
      advance.type='button';advance.onclick=async()=>{
        clearError();
        try{
          await backend.advance(auth.currentUser,a.id);
          setNotice('Moved to '+phaseLabels[['idea','plan','experience','memory'][phaseIndex+1]]+
            '. This tracks the story; it does not mean we both agreed to a plan.');
        }catch(e){error(e);}
      };
      actions.append(advance);
    }
    const choices=element('details','history-list'),heading=element('summary',null,'Change how we’re keeping this');
    choices.append(heading);
    for(const [phase,label] of Object.entries(phaseLabels)){
      if(phase===a.phase)continue;
      const change=element('button','text-button',label);change.type='button';
      change.onclick=async()=>{change.disabled=true;try{await backend.advance(auth.currentUser,a.id,phase);}catch(e){error(e);}finally{change.disabled=false;}};
      choices.append(change);
    }
    if(historicalReadOnly)choices.hidden=true;
    card.append(actions,choices);root.append(card);
  }
  renderTopics();renderTopicHeading();
}
$('idea-form').addEventListener('submit',async e=>{
  e.preventDefault();clearError();
  try{
    const id=await backend.addIdea(auth.currentUser,{title:$('idea-input').value,phase:$('idea-kind').value});
    $('idea-input').value='';setNotice('Our new adventure has its own discussion.');selectTopic(id);
  }catch(e){error(e);}
});
function refreshPending(){
  const root=$('staged-images');root.replaceChildren();
  for(const item of pending){
    const node=element('div','queued'),img=element('img');
    img.src=item.url;img.alt='Image ready to attach';
    const name=element('span',null,item.file.name.slice(0,50));
    const remove=element('button',null,'Remove');remove.type='button';
    remove.onclick=()=>{pending=pending.filter(x=>x!==item);revokePrepared(item);refreshPending();};
    node.append(img,name,remove);root.append(node);
  }
}
$('image-input').addEventListener('change',async e=>{
  const session=authSessionVersion,uid=auth.currentUser?.uid;
  const current=()=>isCurrentAuthSession(session,uid);
  clearError();const choices=[...e.target.files];e.target.value='';
  if(pending.length+choices.length>3){error(Error('Choose no more than three images at a time.'));return;}
  for(const file of choices){
    try{
      setNotice('Preparing image preview…');
      const item=await prepareImage(file);
      if(!current()){revokePrepared(item);return;}
      pending.push(item);refreshPending();
    }catch(e){if(current())error(e);break;}
  }
  if(current()&&!$('error').textContent)setNotice('');
});
async function sendMessage(askAI=false){
  if(sending||!backend||!auth.currentUser)return;
  const session=authSessionVersion,uid=auth.currentUser.uid;
  const current=()=>isCurrentAuthSession(session,uid);
  clearError();const body=$('message-input').value,scope=selectedAdventure,thread=currentConversation,correctsId=correctionId,queued=[...pending];
  if(!body.trim()&&!pending.length){error(Error('Write something or add an image.'));return;}
  sending=true;const send=$('send-button'),ai=$('ask-ai-button');send.disabled=true;ai.disabled=true;
  try{
    const ids=[];
    for(const item of queued){
      setNotice('Saving '+item.file.name+' securely…');
      item.savedId ||= await backend.uploadImage(auth.currentUser,item);
      if(!current())return;
      ids.push(item.savedId);
    }
    const signature=JSON.stringify([body,ids,correctsId]);
    let attempt=sendAttempts.get(thread);
    if(attempt?.signature!==signature){attempt={signature,id:crypto.randomUUID()};sendAttempts.set(thread,attempt);}
    const id=await backend.addMessage(auth.currentUser,{body,attachmentIds:ids,adventureId:scope,correctsId,messageId:attempt.id});
    if(!current())return;
    sendAttempts.delete(thread);
    if(thread===currentConversation && $('message-input').value===body){$('message-input').value='';correctionId=null;$('correction-note').hidden=true;}
    drafts.delete(thread);
    for(const item of queued)revokePrepared(item);
    pending=pending.filter(item=>!queued.includes(item));refreshPending();setNotice('Sent to both of you.');
    if(askAI)await requestAI(id);
    if(scope===selectedAdventure)requestAnimationFrame(scrollToLatest);
  }catch(e){if(current())error(e);}
  finally{if(current()){sending=false;send.disabled=false;ai.disabled=false;}}
}
$('cancel-correction').onclick=()=>{correctionId=null;$('correction-note').hidden=true;};
$('message-form').addEventListener('submit',e=>{e.preventDefault();void sendMessage();});
$('message-input').addEventListener('keydown',event=>{
  if(event.key!=='Enter'||event.isComposing||event.keyCode===229)return;
  if(event.altKey){
    event.preventDefault();const input=event.currentTarget;
    if(input.value.length>=input.maxLength)return;
    input.setRangeText('\n',input.selectionStart,input.selectionEnd,'end');
    input.dispatchEvent(new Event('input',{bubbles:true}));return;
  }
  if(event.shiftKey||event.ctrlKey||event.metaKey)return;
  event.preventDefault();
  if(event.repeat||sending||(!$('message-input').value.trim()&&!pending.length))return;
  $('message-form').requestSubmit($('send-button'));
});
$('ask-ai-button').onclick=()=>sendMessage(true);
async function requestAI(messageId){
  if(!auth.currentUser)return;
  const session=authSessionVersion,uid=auth.currentUser.uid;
  const current=()=>isCurrentAuthSession(session,uid);
  clearError();setNotice('Justelle is preparing a reply…');
  try{
    const token=await auth.currentUser.getIdToken();
    if(!current())return;
    const res=await fetch(runtime.aiUrl,{
      method:'POST',headers:{'Content-Type':'application/json','Authorization':'Bearer '+token},
      redirect:'error',cache:'no-store',body:JSON.stringify({source_message_id:messageId})
    });
    if(!current())return;
    const answer=await res.json();
    if(!current())return;
    if([401,403].includes(res.status)){invalidatePrivateSession();await signOut(auth);return;}
    if(!res.ok)throw Error(answer.error||'Justelle AI is unavailable. Your message is saved.');
    setNotice(answer.replayed?'Justelle already replied to that message.':
      answer.proposal_created?'Justelle shared a suggestion for you both to consider.':'Justelle replied in this discussion.');
  }catch(e){if(current())error(e);}
}
$('export-button').addEventListener('click',async()=>{
  if(!auth.currentUser)return;
  const session=authSessionVersion,uid=auth.currentUser.uid;
  const current=()=>isCurrentAuthSession(session,uid);
  clearError();$('export-button').disabled=true;
  try{
    setNotice('Collecting the full history and checking every original image…');
    const bundle=await backend.exportFictional();
    if(!current())return;
    const blob=new Blob([JSON.stringify(bundle,null,2)],{type:'application/json'});
    const url=URL.createObjectURL(blob),a=document.createElement('a');
    a.href=url;a.download=runtime.mode==='production'?'justelle-memory.json':'justelle-fictional-memory.json';a.click();
    setTimeout(()=>URL.revokeObjectURL(url),5000);
    setNotice('Our full history is ready. This download is unencrypted; keep it private.');
  }catch(e){if(current())error(e);}
  finally{if(current())$('export-button').disabled=false;}
});
$('login-form').addEventListener('submit',async e=>{
  e.preventDefault();clearError();
  try{
    setNotice('Signing in…');
    await signInWithEmailAndPassword(auth,$('email').value,$('password').value);
    $('password').value='';
  }catch(e){error(e);}
});
function clearPrivateSessionUi(){
  for(const unsub of unsubscribers)unsub();unsubscribers=[];
  stopTopic();stopTopic=()=>{};stopPlanner();stopPlanner=()=>{};topicVersion++;
  for(const url of mediaUrls.values())URL.revokeObjectURL(url);
  mediaUrls.clear();attachments.clear();loadingAttachments.clear();loadingOlder=false;
  $('earlier-button').disabled=false;
  for(const draft of drafts.values())for(const item of draft.pending||[])revokePrepared(item);
  drafts.clear();sendAttempts.clear();correctionId=null;$('message-input').value='';$('correction-note').hidden=true;
  $('image-viewer').close();$('full-image').removeAttribute('src');
  backend=null;records={adventures:[],decisions:[],messages:[]};
  selectedAdventure=null;currentConversation=GENERAL_CONVERSATION;
  latest=[];older=[];before=null;hasOlder=false;startedTopic=false;
  for(const item of pending)revokePrepared(item);
  pending=[];sending=false;refreshPending();
  for(const id of [
    'topic-list','topic-source-note','plans-preview','decisions','messages','staged-images',
    'planner-list','planner-summary','planner-lessons','planner-journey','planner-alerts',
    'planner-map','planner-days-view','planner-day-detail','planner-experiences',
    'planner-bookings','planner-booking-source','planner-booking-extraction-feedback','planner-feedback-results',
    'planner-today-result','planner-stays','planner-history','adventures'
  ])$(id)?.replaceChildren();
  for(const id of ['topic-title','topic-subtitle','topic-eyebrow','planner-detail-title',
    'planner-instruction-message','planner-lesson-text','image-caption','planner-edit-status',
    'planner-experience-edit-status'])$(id).textContent='';
  for(const input of $('private-app').querySelectorAll('input,textarea')){
    if(input.type==='checkbox'||input.type==='radio')input.checked=false;
    else input.value='';
  }
  for(const control of $('private-app').querySelectorAll('button,input,textarea,select'))control.disabled=false;
  for(const id of ['planner-trip-form','planner-edit-stay','planner-edit-experience']){
    const form=$(id);if(!form)continue;
    for(const key of ['planId','stopId','experienceId','baseRevision','dirty'])delete form.dataset[key];
  }
  $('planner-edit-stay').hidden=true;$('planner-edit-experience').hidden=true;
  $('planner-booking-stop')?.replaceChildren(new Option('No specific place',''));
  $('planner-detail').hidden=true;
  $('planner-instruction-result').hidden=true;
  $('topic-source-note').hidden=true;
  $('plans-preview').hidden=true;
  $('agreements-tab').hidden=true;
  $('conversation-empty').hidden=false;
  $('adventures-empty').hidden=false;
  for(const details of $('private-app').querySelectorAll('details'))details.open=false;
  for(const img of $('private-app').querySelectorAll('img[src]'))img.removeAttribute('src');
  $('private-app').hidden=true;
  $('sign-out').hidden=true;
  $('send-button').disabled=false;$('ask-ai-button').disabled=false;$('export-button').disabled=false;
  $('email').value='';$('password').value='';
  tab('conversation');
  renderTopicHeading();
  setNotice('');
}
function invalidatePrivateSession(){
  authSessionVersion++;
  clearPrivateSessionUi();
  $('login').hidden=false;
}
$('sign-out').onclick=async()=>{
  clearError();invalidatePrivateSession();
  try{await signOut(auth);}catch(e){error(e);}
};

onAuthStateChanged(auth,async user=>{
  const session=++authSessionVersion;
  const isCurrentSession=()=>session===authSessionVersion&&(!user||auth.currentUser?.uid===user.uid);
  clearPrivateSessionUi();
  $('login').hidden=Boolean(user);$('private-app').hidden=true;$('sign-out').hidden=!user;
  if(!user){setNotice('Sign in once on a trusted browser. Sessions normally persist after reopening.');return;}
  let denied=false;
  const sessionError=e=>{if(isCurrentSession())error(e);};
  try{
    const claims=(await getIdTokenResult(user)).claims;
    if(!isCurrentSession())return;
    if(claims.justelle_member!==true||claims.justelle_room!==roomId){
      denied=true;
      throw Error('This account does not have access to this shared space.');
    }
    const membership=await getDoc(doc(db,'rooms',roomId));
    if(!isCurrentSession())return;
    if(!membership.exists()||!membership.data().uids.includes(user.uid)){
      denied=true;
      throw Error('Member access denied.');
    }
    backend=firebaseBackend({db,storage,roomId,membership:membership.data(),mediaTransport:runtime.mode==='local'?null:protectedMediaTransport({baseUrl:runtime.mediaUrl,getToken:()=>auth.currentUser.getIdToken()})});
    if(testSessionRaces)testSessionRaces.currentPlanner=backend.planner;
    stopPlanner=mountPlannerUI({planner:backend.planner,user,membership:membership.data(),
      onError:sessionError,announce:message=>{if(isCurrentSession())setNotice(message);},
      planAiUrl:runtime.planAiUrl||null,getToken:()=>auth.currentUser.getIdToken()});
    if(!isCurrentSession()){
      stopPlanner();stopPlanner=()=>{};backend=null;return;
    }
    $('private-app').hidden=false;tab(runtime.mode==='production'?'adventures':'conversation');
    setNotice('Signed in; your local session stays available when reopening.');
    let wanted=null;
    try{wanted=localStorage.getItem('justelle-last-topic:'+user.uid)||null;}catch{}
    unsubscribers.push(backend.subscription('decisions',rows=>{
      if(!isCurrentSession())return;
      records.decisions=rows;renderDecisions();renderAdventures();
    },sessionError));
    let first=true;
    unsubscribers.push(backend.subscription('adventures',rows=>{
      if(!isCurrentSession())return;
      records.adventures=rows;
      if(first){
        first=false;
        renderAdventures();
        selectTopic(wanted&&rows.some(a=>a.id===wanted)?wanted:null,{preserveTab:true});
      }else{
        renderAdventures();void renderSourceNote(topicVersion);
      }
    },sessionError));
  }catch(e){
    if(!isCurrentSession())return;
    error(e);
    $('private-app').hidden=true;
    if(denied){invalidatePrivateSession();void signOut(auth).catch(()=>{});}
  }
});
// HTML stays inert until session persistence and every form handler are ready.
// An early tap/Enter must never submit credentials through a native GET form.
for(const id of ['email','password','sign-in-button'])$(id).disabled=false;
