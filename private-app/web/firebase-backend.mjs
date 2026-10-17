import {collection,doc,getDoc,getDocs,onSnapshot,runTransaction,serverTimestamp,setDoc,writeBatch,FieldPath,query,where,orderBy,limit,startAfter} from 'firebase/firestore';
import {ref,uploadBytes,getBytes} from 'firebase/storage';
import {MAX_IMAGE_BYTES,sha256} from './media.mjs';
import {canonicalRecords} from './memory-records.mjs';
import {plannerBackend} from './planner-backend.mjs';
import {createArchive} from './archive-core.mjs';
import {GENERAL_CONVERSATION,topicConversation,contextFor} from './topics.mjs';

const phases=['idea','plan','experience','memory'];
export const MESSAGE_PAGE_SIZE=40;
const time=t=>t?.toMillis?.()||0;
const ascending=rows=>rows.sort((a,b)=>time(a.created_at)-time(b.created_at)||a.id.localeCompare(b.id));

export function firebaseBackend({db,storage,roomId,membership,mediaTransport=null}) {
  const planner=plannerBackend({db,storage,roomId,membership,mediaTransport});
  const roomDoc=doc(db,'rooms',roomId);
  const collectionAt=kind=>collection(roomDoc,kind);
  const docAt=(kind,id)=>doc(collectionAt(kind),id);
  const person=user=>membership.people[user.uid];
  const displayPerson=(id,user)=>id===person(user)?'You':['ai-mock','ai-justelle'].includes(id)?'Justelle AI':id;
  const topicQuery=(conversationId,count=MESSAGE_PAGE_SIZE)=>query(
    collectionAt('messages'),where('conversation_id','==',conversationId),
    orderBy('created_at','desc'),limit(count)
  );
  function context(adventureId) {return contextFor(adventureId);}
  async function readPage(conversationId,before=null) {
    const q=before?query(topicQuery(conversationId),startAfter(before)):topicQuery(conversationId);
    const snap=await getDocs(q);
    return {items:ascending(snap.docs.map(d=>({id:d.id,...d.data()}))),
      cursor:snap.docs.at(-1)||null,hasMore:snap.docs.length===MESSAGE_PAGE_SIZE};
  }
  const subscription=(kind,callback,error,conversationId=GENERAL_CONVERSATION)=>{
    if(kind==='messages') return onSnapshot(topicQuery(conversationId),snap=>
      callback({items:ascending(snap.docs.map(d=>({id:d.id,...d.data()}))),
        cursor:snap.docs.at(-1)||null,hasMore:snap.docs.length===MESSAGE_PAGE_SIZE}),error);
    return onSnapshot(collectionAt(kind),
      snap=>callback(ascending(snap.docs.map(d=>({id:d.id,...d.data()})))),error);
  };
  return {
    membership,person,displayPerson,subscription,readPage,planner,
    async messageById(id) {
      const snap=await getDoc(docAt('messages',id));
      return snap.exists()?{id:snap.id,...snap.data()}:null;
    },
    async getAttachment(id) {
      const snap=await getDoc(docAt('attachments',id));
      return snap.exists()?{id:snap.id,...snap.data()}:null;
    },
    async addMessage(user,{body,attachmentIds=[],adventureId=null,correctsId=null,messageId=null}) {
      if(!body.trim() && !attachmentIds.length) throw Error('Write something or attach an image.');
      const id=messageId||crypto.randomUUID(),scope=context(adventureId);
      const target=docAt('messages',id);
      await runTransaction(db,async transaction=>{
        const existing=await transaction.get(target);
        if(existing.exists()){
          const saved=existing.data();
          if(saved.author_uid!==user.uid||saved.body!==body.trim()||saved.conversation_id!==scope.conversationId||
             (saved.corrects_id||null)!==correctsId||JSON.stringify(saved.attachment_ids)!==JSON.stringify(attachmentIds))
            throw Error('This message has already been saved differently.');
          return; // A lost acknowledgement can be retried without a second message.
        }
        transaction.set(target,{
          body:body.trim(),author_uid:user.uid,author_id:person(user),kind:'person',
          conversation_id:scope.conversationId,adventure_id:scope.adventureId,
          attachment_ids:attachmentIds,corrects_id:correctsId,created_at:serverTimestamp()
        });
      });
      return id;
    },
    async uploadImage(user,prepared) {
      const id=prepared.uploadId||=(crypto.randomUUID()),originalPath='rooms/'+roomId+'/media/'+id;
      const previewPath=prepared.previewBlob?originalPath+'-preview':null;
      const originalBytes=new Uint8Array(await prepared.file.arrayBuffer());
      const checksum=await sha256(originalBytes);
      // Private SDK bytes; no reusable getDownloadURL token.
      await (mediaTransport?mediaTransport.upload(originalPath,originalBytes,{
        contentType:prepared.mime,customMetadata:{author_uid:user.uid,attachment_id:id,role:'original'}
      }):uploadBytes(ref(storage,originalPath),originalBytes,{contentType:prepared.mime,customMetadata:{author_uid:user.uid,attachment_id:id,role:'original'}}));
      if(prepared.previewBlob) await (mediaTransport?mediaTransport.upload(previewPath,prepared.previewBlob,{
        contentType:'image/jpeg',customMetadata:{author_uid:user.uid,attachment_id:id,role:'preview'}
      }):uploadBytes(ref(storage,previewPath),prepared.previewBlob,{contentType:'image/jpeg',customMetadata:{author_uid:user.uid,attachment_id:id,role:'preview'}}));
      const metadata={
        id,author_uid:user.uid,author_id:person(user),name:prepared.file.name.slice(0,180),
        mime:prepared.mime,size:originalBytes.length,sha256:checksum,original_path:originalPath,
        preview_path:previewPath
      };
      await runTransaction(db,async transaction=>{
        const target=docAt('attachments',id),existing=await transaction.get(target);
        if(existing.exists()){
          if(Object.entries(metadata).some(([key,value])=>existing.data()[key]!==value))throw Error('This image is already saved differently.');
          return;
        }
        transaction.set(target,{...metadata,created_at:serverTimestamp()});
      });
      return id;
    },
    async imageBytes(path) {return mediaTransport?mediaTransport.read(path,MAX_IMAGE_BYTES):new Uint8Array(await getBytes(ref(storage,path),MAX_IMAGE_BYTES));},
    async propose(user,{body,why='',replacesId=null,sourceMessageId=null,adventureId=null}) {
      if(!body.trim()) throw Error('Write a suggestion first.');
      if(replacesId && (await getDoc(docAt('decision_replacements',replacesId))).exists())
        throw Error('That plan has already changed. Please suggest a change to the current version.');
      const id=crypto.randomUUID(),scope=context(adventureId);
      await setDoc(docAt('decisions',id),{
        body:body.trim(),why:why.trim(),author_uid:user.uid,author_id:person(user),origin:'human',
        conversation_id:scope.conversationId,adventure_id:scope.adventureId,
        source_message_id:sourceMessageId||null,replaces_id:replacesId||null,
        status:'proposed',approvals:{},approval_times:{},created_at:serverTimestamp(),
        locked_at:null,declined_by:null,declined_at:null
      });
      return id;
    },
    async approve(user,id) {
      const target=docAt('decisions',id);
      return runTransaction(db,async t=>{
        const snap=await t.get(target);
        if(!snap.exists()) throw Error('Suggestion no longer exists.');
        const current=snap.data();
        if(current.status!=='proposed'||current.approvals?.[user.uid])return false;
        const claim=current.replaces_id?docAt('decision_replacements',current.replaces_id):null;
        if(claim && (await t.get(claim)).exists())
          throw Error('That plan has already changed. Please review our current agreement.');
        const next={...current.approvals,[user.uid]:true};
        const locked=membership.uids.length===2&&membership.uids.every(uid=>next[uid]===true);
        t.update(target,
          new FieldPath('approvals',user.uid),true,
          new FieldPath('approval_times',user.uid),serverTimestamp(),
          'status',locked?'locked':'proposed',
          'locked_at',locked?serverTimestamp():null
        );
        // Read the claim before writing: concurrent confirmations race on one
        // document and cannot produce two current replacements.
        if(locked && claim) t.set(claim,{replacement_id:id,locked_at:serverTimestamp()});
        return true;
      });
    },
    async decline(user,id) {
      const target=docAt('decisions',id);
      return runTransaction(db,async t=>{
        const snap=await t.get(target);
        if(!snap.exists())throw Error('Suggestion no longer exists.');
        if(snap.data().status!=='proposed')return false;
        t.update(target,{status:'declined',declined_by:person(user),declined_at:serverTimestamp()});
        return true;
      });
    },
    async addIdea(user,{title,sourceMessageId=null,phase='idea'}) {
      if(!title.trim())throw Error('Give your adventure a short name.');
      if(!phases.includes(phase))throw Error('Choose how you want to remember this.');
      const id=crypto.randomUUID(),eventId=crypto.randomUUID(),batch=writeBatch(db);
      batch.set(docAt('adventures',id),{
        id,title:title.trim(),phase,phases:[phase],last_event_id:eventId,
        author_uid:user.uid,author_id:person(user),last_modified_by:person(user),
        conversation_id:topicConversation(id),source_message_id:sourceMessageId||null,
        created_at:serverTimestamp(),updated_at:serverTimestamp()
      });
      batch.set(docAt('adventure_events',eventId),{adventure_id:id,phase,previous_id:null,prior_phases:[],
        author_uid:user.uid,author_id:person(user),created_at:serverTimestamp()});
      await batch.commit();
      return id;
    },
    async advance(user,id,phase=null) {
      return runTransaction(db,async t=>{
        const target=docAt('adventures',id),snap=await t.get(target);
        if(!snap.exists())throw Error('Adventure no longer exists.');
        const current=snap.data(),index=phases.indexOf(current.phase);
        const next=phase||phases[index+1];
        if(!phases.includes(next)||next===current.phase)return false;
        const eventId=crypto.randomUUID();
        t.set(docAt('adventure_events',eventId),{adventure_id:id,phase:next,previous_id:current.last_event_id||null,prior_phases:current.last_event_id?[]:current.phases,
          author_uid:user.uid,author_id:person(user),created_at:serverTimestamp()});
        t.update(target,{phase:next,last_event_id:eventId,phases:[...current.phases,next],
          updated_at:serverTimestamp(),last_modified_by:person(user)});
        return true;
      });
    },
    async exportFictional() {
      // Export ALL canonical records independently of the paginated display.
      const get=async kind=>(await getDocs(collectionAt(kind))).docs.map(d=>({id:d.id,...d.data()}));
      const [messages,decisions,adventures,attachments,events,adventurePlans,planEvents,planSources,planDocuments]=await Promise.all(
        ['messages','decisions','adventures','attachments','adventure_events',
         'adventure_plans','plan_events','plan_sources','plan_documents'].map(get));
      const records=canonicalRecords({membership,messages,decisions,adventures,attachments,events,
        adventurePlans,planEvents,planSources,planDocuments});
      const files=[];
      for(const a of attachments) {
        files.push({id:a.id,mime:a.mime,bytes:await this.imageBytes(a.original_path)});
        if(a.preview_path)files.push({id:a.id+'-preview',mime:'image/jpeg',bytes:await this.imageBytes(a.preview_path)});
      }
      for(const d of planDocuments){
        if(!mediaTransport?.readDocument)throw Error('Document export requires authenticated media access');
        files.push({id:'doc-'+d.id,mime:d.mime,bytes:await mediaTransport.readDocument(d.id,12*1024*1024)});
      }
      return createArchive(records,files);
    }
  };
}
