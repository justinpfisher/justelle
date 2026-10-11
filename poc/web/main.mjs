import {initializeApp} from 'firebase/app';
import {getAuth,connectAuthEmulator,setPersistence,browserLocalPersistence,signInWithEmailAndPassword,signOut,onAuthStateChanged,getIdTokenResult} from 'firebase/auth';
import {getFirestore,connectFirestoreEmulator} from 'firebase/firestore';
import {getStorage,connectStorageEmulator} from 'firebase/storage';
import {firebaseBackend} from './providers/firebase.mjs';
import {cloudflareBackend} from './providers/cloudflare.mjs';

// This project ID is a local-only emulator fixture. Production requires new keys,
// user provisioning and a separate protected deployment review.
const projectId='demo-justelle-poc';
const app=initializeApp({apiKey:'emulator-only',authDomain:`${projectId}.firebaseapp.com`,projectId,storageBucket:`${projectId}.firebasestorage.app`});
const auth=getAuth(app), db=getFirestore(app), storage=getStorage(app);
const host=location.hostname;
connectAuthEmulator(auth,`http://${host}:9099`,{disableWarnings:true});
connectFirestoreEmulator(db,host,8081);
connectStorageEmulator(storage,host,9199);
await setPersistence(auth,browserLocalPersistence);
const room='fictional-room';
const provider=new URLSearchParams(location.search).get('backend')==='cloudflare'
  ?cloudflareBackend({auth,room})
  :firebaseBackend({db,storage,room});
const $=id=>document.getElementById(id);
const fail=e=>{$('error').textContent=e?.message||'Operation failed';};
const clean=()=>{$('error').textContent='';};
const row=(text)=>{let li=document.createElement('li');li.textContent=text;return li;};
let stopUpdates=()=>{};

$('login-form').addEventListener('submit',async e=>{
 e.preventDefault();clean();
 try{await signInWithEmailAndPassword(auth,$('email').value,$('password').value);$('password').value='';}catch(err){fail(err);}
});
$('signout').addEventListener('click',async()=>{clean();await signOut(auth);});
$('chat-form').addEventListener('submit',async e=>{e.preventDefault();clean();try{await provider.addMessage(auth.currentUser,$('message').value);$('message').value='';await draw();}catch(err){fail(err);}});
$('proposal-form').addEventListener('submit',async e=>{e.preventDefault();clean();try{await provider.propose(auth.currentUser,$('proposal').value);$('proposal').value='';await draw();}catch(err){fail(err);}});
$('file-form').addEventListener('submit',async e=>{e.preventDefault();clean();const file=$('file').files[0];if(!file)return;try{await provider.addPhoto(auth.currentUser,file);$('file').value='';await draw();}catch(err){fail(err);}});

async function draw(){
 if(!auth.currentUser)return;
 const [messages,decisions]=await Promise.all([provider.messages(auth.currentUser),provider.decisions(auth.currentUser)]);
 $('messages').replaceChildren(...messages.map(x=>row(`${x.author_id||x.author_uid}: ${x.body}`)));
 $('decisions').replaceChildren(...decisions.map(x=>{
  const li=document.createElement('li');
  const p=document.createElement('p');p.textContent=`${x.body} — ${x.status} (${Object.keys(x.approvals||{}).length}/2 approvals)`;
  li.append(p);
  if(x.status==='proposed'){
   const btn=document.createElement('button');btn.textContent='Agree';
   btn.disabled=Boolean(x.approvals?.[auth.currentUser.uid]);
   btn.onclick=async()=>{clean();try{await provider.approve(auth.currentUser,x);await draw();}catch(e){fail(e);}};
   li.append(btn);
  }return li;
 }));
}
onAuthStateChanged(auth,async user=>{
 stopUpdates();stopUpdates=()=>{};
 const hasUser=Boolean(user);$('login').hidden=hasUser;$('app').hidden=!hasUser;$('signout').hidden=!hasUser;
 if(hasUser){
  try{
   const claims=(await getIdTokenResult(user)).claims;
   if(claims.justelle_room!==room||claims.justelle_member!==true)throw new Error('This fictional test account has not been granted room access.');
   $('status').textContent='Signed in; persistent local session enabled';
   await draw(); stopUpdates=provider.observe?.(user,()=>draw().catch(fail))||(()=>{});
  }catch(e){fail(e);$('app').hidden=true;}
 } else $('status').textContent='Sign in once on a trusted device; browser storage normally retains the session after closing the app.';
});
