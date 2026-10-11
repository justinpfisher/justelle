import {collection,doc,getDoc,getDocs,onSnapshot,runTransaction,serverTimestamp,setDoc,FieldPath} from 'firebase/firestore';
import {ref,uploadBytes,getBytes} from 'firebase/storage';
import {MAX_IMAGE_BYTES,sha256} from './media.mjs';
import {createArchive} from './archive-core.mjs';

const phases=['idea','plan','experience','memory'];
const asISO=t=>t?.toDate?.()?.toISOString()||null;
export function firebaseBackend({db,storage,roomId,membership}) {
  const roomDoc=doc(db,'rooms',roomId);
  const collectionAt=kind=>collection(roomDoc,kind);
  const docAt=(kind,id)=>doc(collectionAt(kind),id);
  const person=user=>membership.people[user.uid];
  const displayPerson=(id,user)=>id===person(user)?'You':id==='ai-mock'?'Justelle AI':id;
  const sorted=rows=>rows.sort((a,b)=>(a.created_at?.toMillis?.()||0)-(b.created_at?.toMillis?.()||0));
  const subscription=(kind,callback,error)=>onSnapshot(collectionAt(kind),snap=>callback(sorted(snap.docs.map(s=>({id:s.id,...s.data()})))),error);
  return {
    membership,person,displayPerson,subscription,
    async addMessage(user,{body,attachmentIds=[],adventureId=null}) {
      if(!body.trim() && !attachmentIds.length) throw Error('Write something or attach an image.');
      const id=crypto.randomUUID();
      await setDoc(docAt('messages',id),{body:body.trim(),author_uid:user.uid,author_id:person(user),kind:'person',conversation_id:'conversation-shared',adventure_id:adventureId||null,attachment_ids:attachmentIds,created_at:serverTimestamp()});
      return id;
    },
    async uploadImage(user,prepared) {
      const id=crypto.randomUUID();
      const originalPath='rooms/'+roomId+'/media/'+id;
      const previewPath=prepared.previewBlob?originalPath+'-preview':null;
      const originalBytes=new Uint8Array(await prepared.file.arrayBuffer());
      const checksum=await sha256(originalBytes);
      // No getDownloadURL: each display/read must pass Storage Security Rules.
      await uploadBytes(ref(storage,originalPath),originalBytes,{
        contentType:prepared.mime,customMetadata:{author_uid:user.uid,attachment_id:id,role:'original'}
      });
      if(prepared.previewBlob) await uploadBytes(ref(storage,previewPath),prepared.previewBlob,{
        contentType:'image/jpeg',customMetadata:{author_uid:user.uid,attachment_id:id,role:'preview'}
      });
      await setDoc(docAt('attachments',id),{
        id,author_uid:user.uid,author_id:person(user),name:prepared.file.name.slice(0,180),mime:prepared.mime,
        size:originalBytes.length,sha256:checksum,original_path:originalPath,preview_path:previewPath,created_at:serverTimestamp()
      });
      return id;
    },
    async imageBytes(path) {return new Uint8Array(await getBytes(ref(storage,path),MAX_IMAGE_BYTES));},
    async propose(user,{body,why='',replacesId=null,sourceMessageId=null,adventureId=null}) {
      const id=crypto.randomUUID();
      await setDoc(docAt('decisions',id),{
        body:body.trim(),why:why.trim(),author_uid:user.uid,author_id:person(user),origin:'human',
        conversation_id:'conversation-shared',adventure_id:adventureId||null,source_message_id:sourceMessageId||null,
        replaces_id:replacesId||null,status:'proposed',approvals:{},approval_times:{},created_at:serverTimestamp(),locked_at:null
      });
      return id;
    },
    async approve(user,id) {
      const target=docAt('decisions',id);
      return runTransaction(db,async transaction=>{
        const snap=await transaction.get(target);
        if(!snap.exists()) throw Error('Proposal no longer exists.');
        const current=snap.data();
        if(current.status==='locked'||current.approvals?.[user.uid]) return false;
        const next={...current.approvals,[user.uid]:true};
        const locked=membership.uids.length===2&&membership.uids.every(uid=>next[uid]===true);
        transaction.update(target,
          new FieldPath('approvals',user.uid),true,
          new FieldPath('approval_times',user.uid),serverTimestamp(),
          'status',locked?'locked':'proposed',
          'locked_at',locked?serverTimestamp():null
        );
        return true;
      });
    },
    async addIdea(user,{title,sourceMessageId=null}) {
      const id=crypto.randomUUID();
      await setDoc(docAt('adventures',id),{
        id,title:title.trim(),phase:'idea',phases:['idea'],author_uid:user.uid,author_id:person(user),
        last_modified_by:person(user),conversation_id:'conversation-shared',source_message_id:sourceMessageId||null,
        created_at:serverTimestamp(),updated_at:serverTimestamp()
      });
      return id;
    },
    async advance(user,id) {
      return runTransaction(db,async transaction=>{
        const target=docAt('adventures',id);
        const snap=await transaction.get(target);
        if(!snap.exists()) throw Error('Idea no longer exists.');
        const current=snap.data(),index=phases.indexOf(current.phase);
        if(index<0||index===phases.length-1) return false;
        const next=phases[index+1];
        transaction.update(target,{phase:next,phases:[...current.phases,next],updated_at:serverTimestamp(),last_modified_by:person(user)});
        return true;
      });
    },
    async exportFictional() {
      const get=async kind=>(await getDocs(collectionAt(kind))).docs.map(d=>({id:d.id,...d.data()}));
      const [messages,decisions,adventures,attachments]=await Promise.all(['messages','decisions','adventures','attachments'].map(get));
      const uidPerson=uid=>membership.people[uid];
      const records={
        persons:membership.uids.map(uid=>({id:uidPerson(uid),label:membership.labels?.[uid]||'Fictional member'})),
        conversations:[{id:'conversation-shared',kind:'shared'}],
        messages:messages.map(m=>({
          id:m.id,body:m.body,author_id:m.author_id,kind:m.kind,conversation_id:m.conversation_id,
          adventure_id:m.adventure_id??null,source_message_id:m.source_message_id??null,
          attachment_ids:m.attachment_ids||[],created_at:asISO(m.created_at)
        })),
        decisions:decisions.map(d=>({
          id:d.id,body:d.body,why:d.why||'',author_id:d.author_id,origin:d.origin,
          conversation_id:d.conversation_id,adventure_id:d.adventure_id??null,
          source_message_id:d.source_message_id??null,replaces_id:d.replaces_id??null,
          status:d.status,created_at:asISO(d.created_at),locked_at:asISO(d.locked_at),
          approvals:Object.keys(d.approvals||{}).map(uid=>({person_id:uidPerson(uid),at:asISO(d.approval_times?.[uid])}))
        })),
        adventures:adventures.map(a=>({
          id:a.id,title:a.title,phase:a.phase,phases:a.phases,author_id:a.author_id,
          last_modified_by:a.last_modified_by,source_message_id:a.source_message_id,
          conversation_id:a.conversation_id,created_at:asISO(a.created_at),updated_at:asISO(a.updated_at)
        })),
        attachments:attachments.map(a=>({
          id:a.id,name:a.name,mime:a.mime,size:a.size,sha256:a.sha256,author_id:a.author_id,
          created_at:asISO(a.created_at),preview_path:a.preview_path?('media/'+a.id+'-preview'):null
        }))
      };
      const files=[];
      for(const a of attachments) {
        files.push({id:a.id,mime:a.mime,bytes:await this.imageBytes(a.original_path)});
        if(a.preview_path) files.push({id:a.id+'-preview',mime:'image/jpeg',bytes:await this.imageBytes(a.preview_path)});
      }
      return createArchive(records,files);
    }
  };
}
