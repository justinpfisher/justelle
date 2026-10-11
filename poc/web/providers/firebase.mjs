import {collection,doc,getDoc,getDocs,setDoc,updateDoc,onSnapshot,runTransaction} from 'firebase/firestore';
import {ref,uploadBytes,getBytes} from 'firebase/storage';
export function firebaseBackend({db,storage,room}){
 const msg=collection(db,'rooms',room,'messages');
 const decisions=collection(db,'rooms',room,'decisions');
 return {
  async messages(){return (await getDocs(msg)).docs.map(x=>({id:x.id,...x.data()})).sort((a,b)=>a.created_at.localeCompare(b.created_at));},
  async decisions(){return (await getDocs(decisions)).docs.map(x=>({id:x.id,...x.data()})).sort((a,b)=>a.created_at.localeCompare(b.created_at));},
  async addMessage(user,body){await setDoc(doc(msg,crypto.randomUUID()),{body:body.trim(),author_uid:user.uid,created_at:new Date().toISOString()});},
  async propose(user,body){await setDoc(doc(decisions,crypto.randomUUID()),{body:body.trim(),author_uid:user.uid,created_at:new Date().toISOString(),status:'proposed',approvals:{}});},
  async approve(user,decision){
    const participants=(await getDoc(doc(db,'rooms',room))).data().uids;
    const target=doc(decisions,decision.id);
    await runTransaction(db,async t=>{
      const current=(await t.get(target)).data();
      if (!current||current.status==='locked'||current.approvals?.[user.uid]) return;
      const next={...current.approvals,[user.uid]:true};
      const isLocked=participants.every(uid=>next[uid]===true);
      t.update(target,{[`approvals.${user.uid}`]:true,status:isLocked?'locked':'proposed'});
    });
  },
  async addPhoto(user,file){
    if(file.size>1024*1024||!['image/png','image/jpeg'].includes(file.type))throw Error('Invalid test image');
    await uploadBytes(ref(storage,`rooms/${room}/media/${crypto.randomUUID()}`),file,{contentType:file.type,customMetadata:{author_uid:user.uid}});
  },
  observe(user,render){const unsubs=[onSnapshot(msg,()=>render()),onSnapshot(decisions,()=>render())];return()=>unsubs.forEach(f=>f());}
 };
}
