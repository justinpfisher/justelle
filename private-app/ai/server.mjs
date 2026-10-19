// Emulator-only HTTP gateway. Do NOT deploy this development server to the web.
// In a later production deployment, wrap createResponse() with a protected
// HTTPS Firebase Function and a metered vision-capable adapter.
import {createServer} from 'node:http';
import {createHash} from 'node:crypto';
import {initializeApp,deleteApp} from 'firebase-admin/app';
import {getAuth} from 'firebase-admin/auth';
import {getFirestore,FieldValue} from 'firebase-admin/firestore';
import {getStorage} from 'firebase-admin/storage';
import {decisionView} from '../web/topics.mjs';
import {chooseProvider} from './adapter.mjs';
import {createPlannerSuggestionService} from './planner-suggestion-service.mjs';
import {interpretPlanInstruction} from '../web/instruction-core.mjs';

const projectId='demo-justelle-pilot';
for(const [key,port] of [['FIREBASE_AUTH_EMULATOR_HOST',9099],['FIRESTORE_EMULATOR_HOST',8081],['FIREBASE_STORAGE_EMULATOR_HOST',9199]]) {
  if(!['127.0.0.1:'+port,'localhost:'+port].includes(process.env[key])) throw Error('AI test gateway refuses to run outside local Firebase emulators: '+key);
}
const admin=initializeApp({projectId,storageBucket:projectId+'.firebasestorage.app'});
const auth=getAuth(admin),db=getFirestore(admin),storage=getStorage(admin);
const ai=chooseProvider();
const allowedOrigins=new Set(['http://127.0.0.1:5173','http://localhost:5173']);
const requests=new Map();
const limit=uid=>{
  const now=Date.now(),recent=(requests.get(uid)||[]).filter(t=>now-t<60000);
  if(recent.length>=12)throw Object.assign(Error('Fictional AI limit reached'),{status:429});
  recent.push(now);requests.set(uid,recent);
};
// Emulator Storage Rules require document_id rather than the hosted private
// gateway's attachment_id. Normalize *only* within this loopback-only test
// adapter; production storage validation remains untouched.
const syntheticBucket={file:path=>{
  const entry=storage.bucket().file(path);
  return {
    async getMetadata(){
      const [m]=await entry.getMetadata();
      return [{...m,metadata:{...m.metadata,
        attachment_id:m.metadata?.document_id,role:'document'}}];
    },
    download:()=>entry.download()
  };
}};
const plannerProvider=async()=>({name:'fictional-parser-not-vision',async suggest({plan,text,images}){
  const clarification=message=>({kind:'needs_detail',operation:'none',title:'',
    day:0,nights:0,status:'possible',explanation:message,
    uncertainty:'This local test does not use a real AI or interpret image pixels.'});
  if(images.length)return clarification('A protected screenshot was saved, but the fictional provider cannot interpret its contents.');
  const interpreted=interpretPlanInstruction(plan,text);
  if(interpreted.kind!=='ready')return clarification(interpreted.message);
  if(!['add_stop','add_experience'].includes(interpreted.change.type))
    return clarification('Only a new intended place or day experience can be previewed.');
  const change=interpreted.change,item=change.stop||change.experience;
  return {kind:'suggestion',operation:change.type,title:item.title,
    day:change.type==='add_stop'?item.from_day:item.day,
    nights:change.type==='add_stop'?item.through_day-item.from_day:0,
    status:item.status,explanation:'Fictional parse of the original member note.',
    uncertainty:'No supplier booking or external travel facts were checked.'};
}});
const suggestPlan=createPlannerSuggestionService({db,bucket:syntheticBucket,
  roomId:'fictional-room',verifyIdentity:token=>auth.verifyIdToken(token),
  provider:plannerProvider,rateLimit:limit});
const respond=(res,code,payload)=>{
  res.writeHead(code,{'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store','X-Content-Type-Options':'nosniff'});
  res.end(JSON.stringify(payload));
};
export async function createResponse(token,sourceMessageId) {
  const decoded=await auth.verifyIdToken(token);
  const roomId=decoded.justelle_room;
  if(!decoded.justelle_member || roomId!=='fictional-room') throw Object.assign(Error('Not an approved member'),{status:403});
  const membership=(await db.doc('rooms/'+roomId).get()).data();
  if(!membership?.uids?.includes(decoded.uid) || !membership.people?.[decoded.uid]) throw Object.assign(Error('Not a room member'),{status:403});
  if(typeof sourceMessageId!=='string'|| !/^[a-f0-9-]{36}$/.test(sourceMessageId)) throw Object.assign(Error('Invalid message'),{status:400});
  const sourceRef=db.doc('rooms/'+roomId+'/messages/'+sourceMessageId);
  const source=(await sourceRef.get()).data();
  if(!source||source.kind!=='person') throw Object.assign(Error('Message not found'),{status:404});
  const answerRef=db.doc('rooms/'+roomId+'/messages/ai-'+sourceMessageId);
  const existing=await answerRef.get();
  if(existing.exists) return {message_id:answerRef.id,replayed:true};
  limit(decoded.uid);
  const images=[];
  for(const id of (source.attachment_ids||[]).slice(0,3)) {
    const meta=(await db.doc('rooms/'+roomId+'/attachments/'+id).get()).data();
    if(!meta || meta.id!==id || !meta.original_path?.startsWith('rooms/'+roomId+'/media/') || meta.size>12582912) throw Error('Invalid attachment reference');
    const [buffer]=await storage.bucket().file(meta.original_path).download();
    if(buffer.length!==meta.size || createHash('sha256').update(buffer).digest('hex')!==meta.sha256) throw Error('Attachment integrity mismatch');
    images.push({id,mime:meta.mime,bytes:new Uint8Array(buffer)}); // Provider receives original bytes.
  }
  // Supply the adapter only the current discussion, never unrelated room history.
  // This preserves source messages and connected decisions without making the
  // external model the owner of permanent Justelle memory.
  const recentThread=await db.collection('rooms/'+roomId+'/messages')
    .where('conversation_id','==',source.conversation_id)
    .orderBy('created_at','desc').limit(12).get();
  const recentMessages=recentThread.docs.map(d=>({
    id:d.id,body:d.data().body,kind:d.data().kind,author_id:d.data().author_id,
    conversation_id:d.data().conversation_id
  })).reverse();
  const agreements=await db.collection('rooms/'+roomId+'/decisions')
    .where('conversation_id','==',source.conversation_id).get();
  const confirmed=decisionView(agreements.docs.map(d=>({id:d.id,...d.data()})),source.conversation_id)
    .current.slice(0,8).map(d=>({id:d.id,body:d.body,replaces_id:d.replaces_id||null}));
  const response=await ai.respond({message:source,images,context:{
    room_id:roomId,conversation_id:source.conversation_id,
    adventure_id:source.adventure_id||null,messages:recentMessages,confirmed_decisions:confirmed
  }});
  const message={
    body:response.reply,kind:'ai',author_id:'ai-mock',author_uid:null,conversation_id:source.conversation_id,
    adventure_id:source.adventure_id||null,attachment_ids:[],source_message_id:sourceMessageId,
    created_at:FieldValue.serverTimestamp()
  };
  // Reply and any AI suggestion must commit together or not at all.
  // Deterministic document IDs prevent duplicate replies when two requests race.
  const batch=db.batch();
  batch.create(answerRef,message);
  if(response.proposal) {
    const proposalRef=db.doc('rooms/'+roomId+'/decisions/ai-'+sourceMessageId);
    batch.create(proposalRef,{
      body:response.proposal.body,why:response.proposal.why,author_uid:null,author_id:'ai-mock',origin:'ai',
      conversation_id:source.conversation_id,adventure_id:source.adventure_id||null,
      source_message_id:sourceMessageId,replaces_id:null,
      status:'proposed',approvals:{},approval_times:{},created_at:FieldValue.serverTimestamp(),locked_at:null,
      declined_by:null,declined_at:null
    });
  }
  try {await batch.commit();} catch(e) {
    if(e.code===6 || e.code==='already-exists') return {message_id:answerRef.id,replayed:true};
    throw e;
  }
  return {message_id:answerRef.id,proposal_created:Boolean(response.proposal)};
}
const server=createServer(async(req,res)=>{
  const origin=req.headers.origin;
  if(origin && !allowedOrigins.has(origin)) return respond(res,403,{error:'Origin denied'});
  if(origin) {
    res.setHeader('Access-Control-Allow-Origin',origin);
    res.setHeader('Vary','Origin');
    res.setHeader('Access-Control-Allow-Headers','Authorization, Content-Type');
    res.setHeader('Access-Control-Allow-Methods','POST, OPTIONS');
  }
  if(req.method==='OPTIONS') {res.writeHead(204);res.end();return;}
  if(req.method!=='POST'||!['/respond','/plan/suggest'].includes(req.url)) return respond(res,404,{error:'Not found'});
  try {
    let raw='';
    for await(const chunk of req) {
      raw+=chunk;
      if(raw.length>4096) throw Object.assign(Error('Request too large'),{status:413});
    }
    const input=JSON.parse(raw);
    const bearer=/^Bearer (.+)$/.exec(req.headers.authorization||'');
    if(!bearer) return respond(res,401,{error:'Authentication required'});
    if(req.url==='/plan/suggest'){
      if(!input||Array.isArray(input)||Object.keys(input).sort().join(',')!=='plan_id,revision,source_id')
        return respond(res,400,{error:'Invalid planner request'});
      return respond(res,200,await suggestPlan(bearer[1],input));
    }
    if(!input||Object.keys(input).join(',')!=='source_message_id')
      return respond(res,400,{error:'Invalid discussion request'});
    const output=await createResponse(bearer[1],input.source_message_id);
    return respond(res,200,output);
  } catch(e) {
    const status=Number.isInteger(e.status)?e.status:(e.code==='auth/argument-error'||e.code==='auth/id-token-expired'?401:400);
    if(req.url==='/plan/suggest'&&status>=500)
      console.error('Fictional planner test error ('+status+'): '+
        String(e.message||'Unknown').replace(/[^A-Za-z0-9 .,:/-]/g,'?').slice(0,160));
    return respond(res,status,{error:status>=500?'Gateway error':(status===400?'Request failed':e.message)});
  }
});
if(process.argv[1] && import.meta.url===new URL('file://'+process.argv[1]).href) {
  server.listen(8787,'127.0.0.1',()=>process.stdout.write('Local mock AI gateway ready\n'));
  for(const signal of ['SIGTERM','SIGINT']) process.on(signal,()=>{server.close();db.terminate().finally(()=>deleteApp(admin));});
}
