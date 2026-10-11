import {initializeApp} from 'firebase/app';
import {getAuth,connectAuthEmulator,setPersistence,browserLocalPersistence,signInWithEmailAndPassword,signOut,onAuthStateChanged,getIdTokenResult} from 'firebase/auth';
import {getFirestore,connectFirestoreEmulator,doc,getDoc} from 'firebase/firestore';
import {getStorage,connectStorageEmulator} from 'firebase/storage';
import {firebaseBackend} from './firebase-backend.mjs';
import {prepareImage,revokePrepared} from './media.mjs';

// No hosted configuration or real credentials: deliberately refuse non-local origins.
if(!['localhost','127.0.0.1'].includes(location.hostname)) throw Error('This fictional-data pilot is local-only.');
const projectId='demo-justelle-pilot',roomId='fictional-room';
const app=initializeApp({apiKey:'emulator-only',projectId,authDomain:projectId+'.firebaseapp.com',storageBucket:projectId+'.firebasestorage.app'});
const auth=getAuth(app),db=getFirestore(app),storage=getStorage(app);
connectAuthEmulator(auth,'http://'+location.hostname+':9099',{disableWarnings:true});
connectFirestoreEmulator(db,location.hostname,8081);
connectStorageEmulator(storage,location.hostname,9199);
await setPersistence(auth,browserLocalPersistence);

const $=id=>document.getElementById(id);
let backend=null,stop=[],pending=[],replacesId=null,sourceMessageId=null;
let records={messages:[],attachments:[],decisions:[],adventures:[]};
const mediaUrls=new Map();
const muted=new Set();
const setNotice=s=>$('notice').textContent=s||'';
const clearError=()=>{$('error').textContent='';};
function error(e) {$('error').textContent=e?.message||String(e)||'Operation failed';setNotice('');}
function element(tag,cls,text) {
  const node=document.createElement(tag);
  if(cls) node.className=cls;
  if(text!==undefined) node.textContent=text;
  return node;
}
function stamp(time) {
  try {return time?.toDate?.()?.toLocaleString('en-CA',{month:'short',day:'numeric',hour:'numeric',minute:'2-digit'})||'Saving…';}catch{return 'Saving…';}
}
function tab(name) {
  document.querySelectorAll('[data-tab]').forEach(button=>{
    const active=button.dataset.tab===name;
    button.classList.toggle('selected',active);
    if(active) button.setAttribute('aria-current','page');else button.removeAttribute('aria-current');
  });
  for(const area of ['conversation','agreements','adventures']) $(area+'-tab').hidden=area!==name;
}
document.querySelectorAll('[data-tab]').forEach(button=>button.addEventListener('click',()=>tab(button.dataset.tab)));
const labels=()=>backend?.membership?.labels||{};
function authorName(id) {
  if(id==='ai-mock') return 'Justelle AI (test)';
  const uid=backend?.membership?.uids?.find(uid=>backend.person({uid})===id);
  return uid===auth.currentUser?.uid?'You':(labels()[uid]||'Other member');
}
function renderMessages() {
  const list=$('messages');
  list.replaceChildren();
  $('conversation-empty').hidden=records.messages.length>0;
  const attachmentById=new Map(records.attachments.map(a=>[a.id,a]));
  for(const message of records.messages) {
    const bubble=element('li','bubble'+(message.author_id==='ai-mock'?' ai':message.author_id===backend.person(auth.currentUser)?' self':''));
    bubble.dataset.messageId=message.id;
    const who=element('div','who');
    who.append(element('span',null,authorName(message.author_id)),element('time',null,stamp(message.created_at)));
    bubble.append(who);
    if(message.body) bubble.append(element('p',null,message.body));
    for(const id of message.attachment_ids||[]) {
      const attachment=attachmentById.get(id);
      if(!attachment) {bubble.append(element('p','media-note','Preparing attached image…'));continue;}
      const img=element('img','image-tile');
      img.alt='Attached image: '+attachment.name;
      img.loading='lazy';
      const path=attachment.preview_path||attachment.original_path;
      if(mediaUrls.has(path)) img.src=mediaUrls.get(path);
      else if(!muted.has(path)) {
        (async()=>{
          try {
            const bytes=await backend.imageBytes(path);
            const url=URL.createObjectURL(new Blob([bytes],{type:attachment.preview_path?'image/jpeg':attachment.mime}));
            if(!backend||!auth.currentUser) {URL.revokeObjectURL(url);return;}
            mediaUrls.set(path,url);
            if(img.isConnected) img.src=url;
          }catch(e){muted.add(path);if(img.isConnected) img.replaceWith(element('p','media-note','Preview unavailable. '+e.message));}
        })();
      }
      bubble.append(img);
      const download=element('button','text-button','Open original');
      download.type='button';
      download.addEventListener('click',async()=>{
        try {
          const bytes=await backend.imageBytes(attachment.original_path);
          const url=URL.createObjectURL(new Blob([bytes],{type:attachment.mime}));
          const a=document.createElement('a');
          a.href=url;a.download=attachment.name||'justelle-image';a.click();
          setTimeout(()=>URL.revokeObjectURL(url),5000);
        }catch(e){error(e);}
      });
      bubble.append(download);
    }
    if(message.kind==='person') {
      const actions=element('div','message-actions');
      const ask=element('button',null,'Ask Justelle AI');
      ask.type='button';
      ask.onclick=()=>requestAI(message.id);
      const save=element('button',null,'Save as idea');
      save.type='button';
      save.onclick=async()=>{
        clearError();
        try {
          const title=(message.body.trim()||'Explore an image').slice(0,160);
          await backend.addIdea(auth.currentUser,{title,sourceMessageId:message.id});
          setNotice('Idea saved. You can develop it under Adventures.');
        }catch(e){error(e);}
      };
      const propose=element('button',null,'Propose a plan');
      propose.type='button';
      propose.onclick=()=>{
        replacesId=null;sourceMessageId=message.id;
        $('proposal-input').value=message.body.trim().slice(0,4000);
        $('reason-input').value='';
        $('revision-context').hidden=true;$('cancel-revision').hidden=false;
        tab('agreements');$('proposal-input').focus();
      };
      actions.append(ask,save,propose);bubble.append(actions);
    }
    list.append(bubble);
  }
}
function renderDecisions() {
  const root=$('decisions');
  root.replaceChildren();
  $('decisions-empty').hidden=records.decisions.length>0;
  for(const d of records.decisions.slice().reverse()) {
    const card=element('article','record-card');card.dataset.decisionId=d.id;
    const count=Object.keys(d.approvals||{}).length;
    card.append(element('span','tag'+(d.status==='locked'?' locked':''),d.status==='locked'?'Locked · 2/2 approvals':'Proposed · '+count+'/2 approvals'));
    card.append(element('h3',null,d.body));
    card.append(element('p','meta','By '+authorName(d.author_id)+' · '+stamp(d.created_at)));
    if(d.why) card.append(element('p','context',d.why));
    if(d.replaces_id) card.append(element('p','context','Proposed replacement of earlier agreement '+d.replaces_id.slice(0,8)+'. Original remains preserved.'));
    const actions=element('div','actions');
    if(d.status==='proposed') {
      const voted=Boolean(d.approvals?.[auth.currentUser.uid]);
      const agree=element('button',voted?'secondary':'primary',voted?'Your agreement recorded':'I agree');
      agree.type='button';agree.disabled=voted;
      agree.onclick=async()=>{
        clearError();
        try {await backend.approve(auth.currentUser,d.id);setNotice('Your agreement is recorded. Two approvals are needed to lock.');}
        catch(e){error(e);}
      };
      actions.append(agree);
    } else {
      const revise=element('button','secondary','Suggest revision');
      revise.type='button';
      revise.onclick=()=>{
        replacesId=d.id;sourceMessageId=null;
        $('proposal-input').value=d.body;
        $('reason-input').value='';
        $('revision-context').textContent='Creating a new proposal to replace this locked version. The original remains unchanged.';
        $('revision-context').hidden=false;$('cancel-revision').hidden=false;
        $('proposal-input').focus();
        $('proposal-form').scrollIntoView({block:'start',behavior:'smooth'});
      };
      actions.append(revise);
    }
    card.append(actions);root.append(card);
  }
}
function renderAdventures() {
  const root=$('adventures');root.replaceChildren();
  $('adventures-empty').hidden=records.adventures.length>0;
  const select=$('idea-context'),oldValue=select.value;
  select.replaceChildren(new Option('General conversation',''));
  for(const a of records.adventures) {
    select.add(new Option(a.title.slice(0,36),a.id));
    const card=element('article','record-card');card.dataset.adventureId=a.id;
    card.append(element('span','tag',a.phase[0].toUpperCase()+a.phase.slice(1)));
    card.append(element('h3',null,a.title));
    card.append(element('p','meta',a.phases.join(' → ')+' · Saved by '+authorName(a.author_id)));
    const actions=element('div','actions');
    const phaseList=['idea','plan','experience','memory'],i=phaseList.indexOf(a.phase);
    if(i<3){
      const advance=element('button','secondary','Move to '+phaseList[i+1]);
      advance.type='button';advance.onclick=async()=>{
        clearError();try{await backend.advance(auth.currentUser,a.id);setNotice('Adventure advanced; prior phases retained.');}catch(e){error(e);}
      };actions.append(advance);
    }
    const discuss=element('button','text-button','Discuss');
    discuss.type='button';discuss.onclick=()=>{tab('conversation');select.value=a.id;$('message-input').focus();};
    actions.append(discuss);card.append(actions);root.append(card);
  }
  select.value=records.adventures.some(a=>a.id===oldValue)?oldValue:'';
}
function rerender() {
  if(!backend||!auth.currentUser)return;
  renderMessages();renderDecisions();renderAdventures();
}
function refreshPending() {
  const root=$('staged-images');root.replaceChildren();
  for(const item of pending) {
    const node=element('div','queued');
    const img=element('img');img.src=item.url;img.alt='Selected image preview';
    const title=element('span',null,item.file.name.slice(0,50));
    const remove=element('button',null,'Remove');remove.type='button';
    remove.addEventListener('click',()=>{pending=pending.filter(x=>x!==item);revokePrepared(item);refreshPending();});
    node.append(img,title,remove);root.append(node);
  }
}
$('image-input').addEventListener('change',async e=>{
  clearError();
  const choices=[...e.target.files];e.target.value='';
  if(pending.length+choices.length>3){error(Error('Attach no more than three images to a message.'));return;}
  for(const file of choices) {
    try {
      setNotice('Preparing image preview…');
      const prepared=await prepareImage(file);
      pending.push(prepared);refreshPending();
    }catch(e){error(e);break;}
  }
  setNotice('');
});
async function sendMessage(askAI=false) {
  if(!backend || !auth.currentUser)return;
  clearError();const body=$('message-input').value;
  if(!body.trim()&&!pending.length){error(Error('Enter a message or choose an image.'));return;}
  const button=$('send-button'),aiButton=$('ask-ai-button');
  button.disabled=true;aiButton.disabled=true;
  try {
    const attachments=[];
    for(const prepared of pending) {
      setNotice('Saving '+prepared.file.name+' securely…');
      attachments.push(await backend.uploadImage(auth.currentUser,prepared));
    }
    const id=await backend.addMessage(auth.currentUser,{body,attachmentIds:attachments,adventureId:$('idea-context').value||null});
    $('message-input').value='';
    for(const item of pending)revokePrepared(item);
    pending=[];refreshPending();
    setNotice('Shared with both members.');
    if(askAI) await requestAI(id);
  }catch(e){error(e);}
  finally{button.disabled=false;aiButton.disabled=false;}
}
$('message-form').addEventListener('submit',e=>{e.preventDefault();void sendMessage();});
const askButton=element('button','secondary','Ask AI');
askButton.id='ask-ai-button';askButton.type='button';askButton.onclick=()=>sendMessage(true);
$('send-button').before(askButton);
async function requestAI(messageId) {
  if(!auth.currentUser)return;
  clearError();setNotice('Justelle test AI is composing…');
  try {
    const token=await auth.currentUser.getIdToken();
    const response=await fetch('http://127.0.0.1:8787/respond',{
      method:'POST',headers:{'Content-Type':'application/json','Authorization':'Bearer '+token},
      body:JSON.stringify({source_message_id:messageId})
    });
    const answer=await response.json();
    if(!response.ok)throw Error(answer.error||'AI gateway unavailable');
    setNotice(answer.replayed?'The test AI has already answered this message.':'Test AI replied. A proposal, if any, still needs both approvals.');
  }catch(e){error(e);}
}
$('proposal-form').addEventListener('submit',async e=>{
  e.preventDefault();clearError();
  try {
    await backend.propose(auth.currentUser,{
      body:$('proposal-input').value,why:$('reason-input').value,replacesId,sourceMessageId,
      adventureId:$('idea-context').value||null
    });
    $('proposal-input').value='';$('reason-input').value='';
    replacesId=null;sourceMessageId=null;$('revision-context').hidden=true;$('cancel-revision').hidden=true;
    setNotice('Saved as a proposal, not a decision.');
  }catch(e){error(e);}
});
$('cancel-revision').onclick=()=>{
  replacesId=null;sourceMessageId=null;$('revision-context').hidden=true;$('cancel-revision').hidden=true;
  $('proposal-input').value='';$('reason-input').value='';
};
$('idea-form').addEventListener('submit',async e=>{
  e.preventDefault();clearError();
  try {await backend.addIdea(auth.currentUser,{title:$('idea-input').value});$('idea-input').value='';setNotice('Idea saved.');}
  catch(e){error(e);}
});
$('export-button').addEventListener('click',async()=>{
  clearError();$('export-button').disabled=true;
  try {
    setNotice('Collecting original media and verifying archive checksums…');
    const bundle=await backend.exportFictional();
    const blob=new Blob([JSON.stringify(bundle,null,2)],{type:'application/json'});
    const url=URL.createObjectURL(blob);
    const a=document.createElement('a');a.href=url;a.download='justelle-fictional-memory.json';a.click();
    setTimeout(()=>URL.revokeObjectURL(url),5000);
    setNotice('Fictional export prepared. It is unencrypted: never use this pilot for private content.');
  }catch(e){error(e);}
  finally{$('export-button').disabled=false;}
});
$('login-form').addEventListener('submit',async e=>{
  e.preventDefault();clearError();
  try {
    setNotice('Signing in…');
    await signInWithEmailAndPassword(auth,$('email').value,$('password').value);
    $('password').value='';
  } catch(e){error(e);}
});
$('sign-out').onclick=async()=>{clearError();await signOut(auth);};
onAuthStateChanged(auth,async user=>{
  for(const fn of stop)fn();stop=[];
  for(const url of mediaUrls.values()) URL.revokeObjectURL(url);
  mediaUrls.clear();muted.clear();
  backend=null;records={messages:[],attachments:[],decisions:[],adventures:[]};
  for(const item of pending)revokePrepared(item);
  pending=[];refreshPending();
  $('login').hidden=Boolean(user);$('private-app').hidden=true;$('sign-out').hidden=!user;
  if(!user){setNotice('Sign in once on a trusted browser. Sessions normally persist after reopening.');return;}
  try {
    const claims=(await getIdTokenResult(user)).claims;
    if(claims.justelle_member!==true||claims.justelle_room!==roomId)throw Error('This account is not authorised for the fictional room.');
    const memberDoc=await getDoc(doc(db,'rooms',roomId));
    if(!memberDoc.exists()||!memberDoc.data().uids.includes(user.uid))throw Error('Member access denied.');
    backend=firebaseBackend({db,storage,roomId,membership:memberDoc.data()});
    $('private-app').hidden=false;
    setNotice('Signed in; persistent local session enabled.');
    for(const kind of Object.keys(records))stop.push(backend.subscription(kind,rows=>{records[kind]=rows;rerender();},error));
    rerender();
  }catch(e){error(e);$('private-app').hidden=true;}
});
