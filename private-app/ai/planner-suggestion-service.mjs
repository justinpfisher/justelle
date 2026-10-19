// Authenticated, read-only AI planner boundary. The source and plan come from
// private Firestore records, not client-supplied model context. Only a member
// using the normal Firestore transaction can later apply the returned edit.
import {createHash} from 'node:crypto';
import {approvedMember} from '../hosting/media-handler.mjs';
import {validatePlanSuggestion} from '../web/plan-suggestion-core.mjs';
const fail=(status,message)=>Object.assign(Error(message),{status});
const ID=/^[A-Za-z0-9][A-Za-z0-9_.:-]{0,127}$/;
const UUID=/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/;
export function createPlannerSuggestionService({db,bucket,roomId,verifyIdentity,provider,
  rateLimit=async()=>{}}){
  const root='rooms/'+roomId;
  const member=token=>approvedMember(token,{roomId,verifyIdentity,
    readMembership:async id=>(await db.doc('rooms/'+id).get()).data()});
  return async(token,input)=>{
    const identity=await member(token);
    if(!input||Object.keys(input).sort().join(',')!=='plan_id,revision,source_id'||
      typeof input.plan_id!=='string'||!ID.test(input.plan_id)||
      !Number.isSafeInteger(input.revision)||input.revision<0||
      typeof input.source_id!=='string'||!UUID.test(input.source_id))
      throw fail(400,'Invalid planner suggestion request');
    const planSnap=await db.doc(root+'/adventure_plans/'+input.plan_id).get();
    if(!planSnap.exists)throw fail(404,'Adventure not found');
    const plan=planSnap.data().state;
    if(plan?.id!==input.plan_id||plan.revision!==input.revision)
      throw fail(409,'The shared plan has changed');
    if(plan.status!=='planning'||!Array.isArray(plan.stops)||!Array.isArray(plan.bookings))
      throw fail(400,'Unsupported adventure');
    const sourceSnap=await db.doc(root+'/plan_sources/'+input.source_id).get();
    const source=sourceSnap.data();
    if(!sourceSnap.exists||source.id!==input.source_id||
      source.adventure_id!==plan.id||source.kind!=='note'||
      typeof source.notes!=='string'||source.notes.length>300)
      throw fail(404,'Planning note not found');
    const images=[];
    if(source.document_id){
      const documentId=source.document_id;
      if(!UUID.test(documentId))throw fail(400,'Invalid screenshot reference');
      const doc=(await db.doc(root+'/plan_documents/'+documentId).get()).data();
      const path=root+'/documents/'+documentId;
      if(!doc||doc.id!==documentId||doc.adventure_id!==plan.id||
        doc.storage_path!==path||!['image/png','image/jpeg'].includes(doc.mime)||
        !Number.isSafeInteger(doc.size)||doc.size<1||doc.size>12*1024*1024||
        !/^[a-f0-9]{64}$/.test(doc.sha256))
        throw fail(400,'A private PNG or JPEG screenshot is required');
      const original=bucket.file(path),[meta]=await original.getMetadata();
      if(meta.metadata?.firebaseStorageDownloadTokens||meta.contentType!==doc.mime||
        Number(meta.size)!==doc.size||meta.metadata?.attachment_id!==documentId||
        meta.metadata?.role!=='document'||meta.metadata?.sha256!==doc.sha256||
        meta.metadata?.author_uid!==doc.author_uid)
        throw fail(503,'Screenshot integrity could not be verified');
      const [bytes]=await original.download();
      if(bytes.length!==doc.size||
        createHash('sha256').update(bytes).digest('hex')!==doc.sha256)
        throw fail(503,'Screenshot integrity could not be verified');
      images.push({mime:doc.mime,bytes:new Uint8Array(bytes)});
    }
    if(!source.notes.trim()&&!images.length)
      throw fail(400,'A planning note or screenshot is required');
    await rateLimit(identity.uid);
    const ai=await provider();
    if(typeof ai.suggest!=='function')throw fail(503,'Planner interpretation unavailable');
    const candidate=await ai.suggest({roomId,permission:identity,
      sourceId:source.id,plan,text:source.notes,images});
    const preview=validatePlanSuggestion(plan,candidate);
    // Approval may have been revoked or another member may have edited while
    // the paid model was responding. Return no stale proposal in either case.
    await member(token);
    const latest=(await db.doc(root+'/adventure_plans/'+plan.id).get()).data()?.state;
    if(latest?.revision!==plan.revision)throw fail(409,'The shared plan has changed');
    return {plan_id:plan.id,revision:plan.revision,source_id:source.id,...preview};
  };
}
