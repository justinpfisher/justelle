// Shared local/hosted orchestration. Models receive data, never database access.
import {createHash} from 'node:crypto';
import {decisionView} from '../web/topics.mjs';
import {approvedMember} from '../hosting/media-handler.mjs';
const fail=(status,message)=>Object.assign(Error(message),{status});
const uuid=/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/;
export function createResponseService({db,bucket,roomId,verifyIdentity,provider,serverTimestamp,rateLimit=async()=>{}}){
  return async(token,sourceMessageId)=>{
    const permission=await approvedMember(token,{roomId,verifyIdentity,readMembership:async id=>{
      const snap=await db.doc('rooms/'+id).get();return snap.exists?snap.data():null;
    }});
    if(typeof sourceMessageId!=='string'||!uuid.test(sourceMessageId))throw fail(400,'Invalid message');
    const root='rooms/'+roomId;
    const sourceSnap=await db.doc(root+'/messages/'+sourceMessageId).get();
    const source=sourceSnap.data();
    if(!source||source.kind!=='person')throw fail(404,'Message not found');
    const answerRef=db.doc(root+'/messages/ai-'+sourceMessageId),existing=await answerRef.get();
    if(existing.exists)return {message_id:answerRef.id,replayed:true};
    await rateLimit(permission.uid);
    const images=[];
    if(!Array.isArray(source.attachment_ids)||source.attachment_ids.length>3)throw fail(400,'Invalid images');
    for(const id of source.attachment_ids){
      const meta=(await db.doc(root+'/attachments/'+id).get()).data();
      if(!uuid.test(id)||!meta||meta.id!==id||meta.original_path!==root+'/media/'+id||
        !Number.isSafeInteger(meta.size)||meta.size<1||meta.size>12582912)throw fail(400,'Invalid attachment');
      const original=bucket.file(meta.original_path),[metadata]=await original.getMetadata();
      if(metadata.metadata?.firebaseStorageDownloadTokens||Number(metadata.size)!==meta.size||metadata.contentType!==meta.mime)
        throw fail(503,'Image integrity could not be verified');
      const [bytes]=await original.download();
      if(bytes.length!==meta.size||createHash('sha256').update(bytes).digest('hex')!==meta.sha256)
        throw fail(503,'Image integrity could not be verified');
      if(['image/heic','image/heif'].includes(meta.mime)){
        if(meta.preview_path!==root+'/media/'+id+'-preview')throw fail(400,'Image needs a JPEG preview');
        const preview=bucket.file(meta.preview_path),[p]=await preview.getMetadata();
        if(p.contentType!=='image/jpeg'||p.metadata?.firebaseStorageDownloadTokens||Number(p.size)>12582912||
          p.metadata?.attachment_id!==id||p.metadata?.role!=='preview')throw fail(503,'Image preview unavailable');
        const [converted]=await preview.download();
        if(converted.length!==Number(p.size)||!converted.length)throw fail(503,'Image preview unavailable');
        images.push({id,mime:'image/jpeg',bytes:new Uint8Array(converted)});
      }else images.push({id,mime:meta.mime,bytes:new Uint8Array(bytes)});
    }
    const recent=await db.collection(root+'/messages').where('conversation_id','==',source.conversation_id)
      .orderBy('created_at','desc').limit(12).get();
    const agreements=await db.collection(root+'/decisions').where('conversation_id','==',source.conversation_id).get();
    const context={room_id:roomId,conversation_id:source.conversation_id,adventure_id:source.adventure_id||null,
      messages:recent.docs.map(d=>({id:d.id,...d.data()})).reverse(),
      confirmed_decisions:decisionView(agreements.docs.map(d=>({id:d.id,...d.data()})),source.conversation_id)
        .current.slice(0,8).map(d=>({id:d.id,body:d.body,replaces_id:d.replaces_id||null}))};
    const ai=await provider();
    const response=await ai.respond({message:{...source,id:sourceMessageId},images,context,
      permission:{...permission,conversationId:source.conversation_id,sourceMessageId}});
    // Check membership again after external work before committing a result.
    await approvedMember(token,{roomId,verifyIdentity,readMembership:async id=>(await db.doc('rooms/'+id).get()).data()});
    const authorId=ai.name==='deterministic-local'?'ai-mock':'ai-justelle';
    const shared={author_uid:null,author_id:authorId,conversation_id:source.conversation_id,
      adventure_id:source.adventure_id||null,source_message_id:sourceMessageId,created_at:serverTimestamp()};
    const batch=db.batch();
    batch.create(answerRef,{...shared,body:response.reply,kind:'ai',attachment_ids:[]});
    if(response.proposal)batch.create(db.doc(root+'/decisions/ai-'+sourceMessageId),{
      ...shared,body:response.proposal.body,why:response.proposal.why,origin:'ai',replaces_id:null,
      status:'proposed',approvals:{},approval_times:{},locked_at:null,declined_by:null,declined_at:null});
    try{await batch.commit();}catch(e){if(e.code===6||e.code==='already-exists')return {message_id:answerRef.id,replayed:true};throw e;}
    return {message_id:answerRef.id,proposal_created:Boolean(response.proposal)};
  };
}
