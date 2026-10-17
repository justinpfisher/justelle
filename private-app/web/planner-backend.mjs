// Protected two-member planner gateway. Legacy chat/approval records are not migrated
// into this collection, preventing historical rules from controlling live plans.
import {collection,doc,getDoc,getDocs,onSnapshot,query,where,runTransaction,serverTimestamp} from 'firebase/firestore';
import {createItinerary,applyItineraryEdit} from './itinerary-core.mjs';
import {sha256} from './media.mjs';
const ID=/^[A-Za-z0-9][A-Za-z0-9_.:-]{0,127}$/;
const UUID=/^[a-f0-9-]{36}$/;
const text=(s,max)=>{if(typeof s!=='string'||!s.trim()||s.length>max)throw Error('Invalid text');return s.trim();};
const id=s=>{if(typeof s!=='string'||!ID.test(s))throw Error('Invalid stable ID');return s;};
const documentMimes=new Set(['application/pdf','image/png','image/jpeg','image/heic','image/heif']);
export function plannerBackend({db,roomId,membership,mediaTransport=null}){
  if(!membership?.uids||membership.uids.length!==2)throw Error('Two-member room required');
  const root=doc(db,'rooms',roomId),at=(kind,key)=>doc(collection(root,kind),key);
  function actor(user){
    if(!membership.uids.includes(user?.uid)||!membership.people?.[user.uid])throw Error('Member sign-in required');
    return {author_uid:user.uid,author_id:membership.people[user.uid]};
  }
  const asPlan=s=>s.exists()?{...s.data().state,created_at:s.data().created_at,updated_at:s.data().updated_at,
    author_id:s.data().author_id,last_modified_by:s.data().last_modified_by}:null;
  return {
    subscribePlans(onChange,onError){
      return onSnapshot(collection(root,'adventure_plans'),
        s=>onChange(s.docs.map(asPlan)),onError);
    },
    async readPlan(key){return asPlan(await getDoc(at('adventure_plans',id(key))));},
    async readHistory(key){
      const q=query(collection(root,'plan_events'),where('adventure_id','==',id(key)));
      return (await getDocs(q)).docs.map(s=>({id:s.id,...s.data()})).sort((a,b)=>a.revision-b.revision);
    },
    async createPlan(user,{id:planId=crypto.randomUUID(),title,durationDays=21,startsOn=null}){
      const author=actor(user),state=createItinerary({id:id(planId),title,durationDays,startsOn});
      const eventId=crypto.randomUUID(),planRef=at('adventure_plans',planId),eventRef=at('plan_events',eventId);
      state.last_event_id=eventId;
      await runTransaction(db,async t=>{
        if((await t.get(planRef)).exists())throw Error('Adventure already exists');
        t.set(planRef,{state,...author,last_modified_by:author.author_id,
          created_at:serverTimestamp(),updated_at:serverTimestamp()});
        t.set(eventRef,{id:eventId,adventure_id:planId,revision:0,previous_event_id:null,
          actor_id:author.author_id,...author,operation:'create_trip',collection:'trip',record_id:planId,
          before:null,after:state,before_state:null,after_state:state,created_at:serverTimestamp()});
      });
      return planId;
    },
    async editPlan(user,planId,change,expectedRevision,{eventId=crypto.randomUUID()}={}){
      const author=actor(user);id(planId);id(eventId);
      if(!Number.isSafeInteger(expectedRevision)||expectedRevision<0)
        throw Error('Open the latest plan before editing');
      return runTransaction(db,async t=>{
        const target=at('adventure_plans',planId),saved=await t.get(target);
        if(!saved.exists())throw Error('Adventure no longer exists');
        const previous=saved.data().state;
        if(previous.id!==planId||previous.revision!==expectedRevision)
          throw Error('The adventure changed. Review the latest plan before trying again.');
        let lastEvent=null,source=null;
        if(change?.type==='undo_last'){
          const prev=await t.get(at('plan_events',previous.last_event_id));
          if(!prev.exists())throw Error('Original edit missing; cannot Undo');
          lastEvent=prev.data();
        }
        const sourceId=change?.type==='add_booking'?change.booking?.source_id:
          change?.type==='correct_booking'?change.patch?.source_id:
          null;
        if(sourceId){
          source=await t.get(at('plan_sources',id(sourceId)));
          if(!source.exists()||source.data().adventure_id!==planId)
            throw Error('Booking source is missing or belongs to another adventure');
        }
        const {plan,event}=applyItineraryEdit(previous,change,{eventId,actorId:author.author_id,
          at:new Date().toISOString(),lastEvent});
        if(['add_booking','correct_booking'].includes(change.type)&&event.after?.status==='confirmed'){
          const actualSource=event.after.source_id;
          if(!actualSource)throw Error('A confirmed booking needs its original source');
          if(!source||source.id!==actualSource||source.data().kind!=='booking')
            throw Error('Open the original booking source before confirming');
        }
        const eventRef=at('plan_events',eventId);
        if((await t.get(eventRef)).exists())throw Error('This edit ID has already been used');
        // The event carries exact before/after state. Firestore Rules enforce both
        // directions of the atomic relationship even if a client is modified.
        t.set(eventRef,{...event,...author,created_at:serverTimestamp(),
          before_state:previous,after_state:plan});
        t.set(target,{...saved.data(),state:plan,last_modified_by:author.author_id,
          updated_at:serverTimestamp()});
        return {plan,event:{...event,author_id:author.author_id}};
      });
    },
    async addSource(user,{id:sourceId=crypto.randomUUID(),adventureId,kind='note',title,notes='',supplier='',reference='',documentId=null}){
      const author=actor(user);id(sourceId);id(adventureId);
      if(!['booking','note','research'].includes(kind))throw Error('Invalid source kind');
      const item={id:sourceId,adventure_id:adventureId,kind,title:text(title,180),
        notes:typeof notes==='string'&&notes.length<=4000?notes:(()=>{throw Error('Invalid source notes')})(),
        supplier:typeof supplier==='string'&&supplier.length<=180?supplier:(()=>{throw Error('Invalid supplier')})(),
        reference:typeof reference==='string'&&reference.length<=180?reference:(()=>{throw Error('Invalid reference')})(),
        document_id:documentId===null?null:id(documentId),...author,created_at:serverTimestamp()};
      await runTransaction(db,async t=>{
        if(!(await t.get(at('adventure_plans',adventureId))).exists())throw Error('Adventure not found');
        if(documentId){
          const d=await t.get(at('plan_documents',documentId));
          if(!d.exists()||d.data().adventure_id!==adventureId)throw Error('Document not found for adventure');
        }
        const target=at('plan_sources',sourceId);
        if((await t.get(target)).exists())throw Error('Original source already exists');
        t.set(target,item);
      });
      return sourceId;
    },
    async addDocument(user,{id:documentId=crypto.randomUUID(),adventureId,file}){
      const author=actor(user);id(adventureId);
      if(!UUID.test(documentId))throw Error('Document identifier must be a UUID');
      if(!file||!documentMimes.has(file.type)||file.size<=0||file.size>12*1024*1024)
        throw Error('Use a PDF or supported image under 12 MB');
      if(!mediaTransport?.uploadDocument)throw Error('Private document service is not configured');
      if(!(await getDoc(at('adventure_plans',adventureId))).exists())throw Error('Adventure not found');
      const bytes=new Uint8Array(await file.arrayBuffer()),digest=await sha256(bytes);
      await mediaTransport.uploadDocument(documentId,bytes,file.type);
      const metadata={id:documentId,adventure_id:adventureId,name:text(file.name,180),
        mime:file.type,size:bytes.length,sha256:digest,
        storage_path:'rooms/'+roomId+'/documents/'+documentId,...author};
      await runTransaction(db,async t=>{
        const target=at('plan_documents',documentId),saved=await t.get(target);
        if(saved.exists()){
          const row=saved.data();
          if(Object.entries(metadata).some(([key,value])=>row[key]!==value))
            throw Error('Document already exists with different content');
          return;
        }
        t.set(target,{...metadata,created_at:serverTimestamp()});
      });
      return documentId;
    }
  };
}
