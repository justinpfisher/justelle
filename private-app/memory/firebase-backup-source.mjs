// Consistent metadata snapshot + immutable original streams.
// Production requires the separately qualified runtime to pass productionApproved.
import {canonicalRecords} from '../web/memory-records.mjs';
import {verifyRecords} from '../web/archive-core.mjs';
import {writeEncryptedBackup} from './encrypted-backup.mjs';
export async function firebaseBackupSource({db,bucket,roomId='fictional-room',pageSize=200,productionApproved=false}){
  if(!/^[a-zA-Z0-9-]{1,100}$/.test(roomId)||roomId!=='fictional-room'&&!productionApproved)throw Error('Real-content backup activation is not approved');
  if(!Number.isSafeInteger(pageSize)||pageSize<1||pageSize>500)throw Error('Invalid backup page size');
  const root='rooms/'+roomId;
  // Every query executes inside ONE read-only transaction, so historical decisions,
  // new messages and event pointers cannot come from different read times.
  const snapshot=await db.runTransaction(async transaction=>{
    const room=await transaction.get(db.doc(root)),membership=room.data();
    if(!room.exists||membership.uids?.length!==2||membership.uids.some(uid=>!membership.people?.[uid]))throw Error('Invalid room membership');
    const result={membership};
    for(const kind of ['messages','decisions','adventures','attachments','adventure_events','adventure_plans','plan_events','plan_sources','plan_documents']){
      const rows=[];let cursor;
      do{
        let query=db.collection(root+'/'+kind).orderBy('__name__').limit(pageSize);
        if(cursor)query=query.startAfter(cursor);
        const page=await transaction.get(query);
        rows.push(...page.docs.map(d=>({id:d.id,...d.data()})));
        cursor=page.size===pageSize?page.docs.at(-1):null;
      }while(cursor);
      result[kind==='adventure_events'?'events':kind]=rows;
    }
    return result;
  },{readOnly:true});
  const records=canonicalRecords({...snapshot,
    adventurePlans:snapshot.adventure_plans,
    planEvents:snapshot.plan_events,planSources:snapshot.plan_sources,
    planDocuments:snapshot.plan_documents});verifyRecords(records);
  async function* media(){
    for(const a of snapshot.attachments){
      if(a.original_path!==root+'/media/'+a.id||(a.preview_path&&a.preview_path!==root+'/media/'+a.id+'-preview'))throw Error('Backup image path is outside its canonical room');
      yield {id:a.id,mime:a.mime,stream:bucket.file(a.original_path).createReadStream()};
      if(a.preview_path)yield {id:a.id+'-preview',mime:'image/jpeg',stream:bucket.file(a.preview_path).createReadStream()};
    }
    for(const d of snapshot.plan_documents){
      if(d.storage_path!==root+'/documents/'+d.id)throw Error('Backup document path is outside canonical room');
      yield {id:'doc-'+d.id,mime:d.mime,stream:bucket.file(d.storage_path).createReadStream()};
    }
  }
  return {records,media:media()};
}
export async function backupFictionalFirebase({db,bucket,key,roomId,pageSize},destination){
  const source=await firebaseBackupSource({db,bucket,roomId,pageSize});
  return writeEncryptedBackup({...source,key},destination);
}
