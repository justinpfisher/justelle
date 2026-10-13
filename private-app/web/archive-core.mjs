// No provider SDK dependency. This compact JSON archive is intentionally for
// fictional/local use only: real backups need encryption, streaming and recovery drills.
import {sha256} from './media.mjs';
export const archiveFormat='justelle-memory-v1';
export const recordKinds=['persons','conversations','messages','decisions','adventures','attachments'];
export const optionalRecordKinds=['adventure_events'];

function binaryToBase64(data) {
  if (typeof Buffer!=='undefined') return Buffer.from(data).toString('base64');
  let value='';
  for(let i=0;i<data.length;i+=8192) value+=String.fromCharCode(...data.subarray(i,i+8192));
  return btoa(value);
}
function base64ToBinary(value) {
  if (typeof value!=='string'|| !/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(value)) throw Error('Invalid base64 media');
  if(typeof Buffer!=='undefined') return new Uint8Array(Buffer.from(value,'base64'));
  const binary=atob(value);
  return Uint8Array.from(binary,c=>c.charCodeAt(0));
}
function namesAreUnique(rows,label) {
  const ids=rows.map(x=>x?.id);
  if(ids.some(id=>typeof id!=='string'||!id||id.length>160)||new Set(ids).size!==ids.length) throw Error('Invalid or duplicate IDs in '+label);
}
function requireLink(id,ids,label,required=false) {
  if(required&&(id===null||id===undefined))throw Error('Missing '+label+' relationship');
  if(id!==null && id!==undefined && !ids.has(id)) throw Error('Broken '+label+' relationship: '+id);
}
export async function createArchive(records,files) {
  for(const kind of recordKinds) if(!Array.isArray(records?.[kind])) throw Error('Missing '+kind);
  const media=[];
  for(const f of files) {
    const bytes=f.bytes instanceof Uint8Array?f.bytes:new Uint8Array(f.bytes);
    if(bytes.length>12*1024*1024||bytes.length===0) throw Error('Media outside pilot size limit');
    media.push({id:f.id,mime:f.mime,sha256:await sha256(bytes),bytes:binaryToBase64(bytes)});
  }
  const bundle={format:archiveFormat,created_at:new Date().toISOString(),records,records_sha256:await sha256(new TextEncoder().encode(JSON.stringify(records))),media};
  await verifyArchive(bundle);
  return bundle;
}
export async function verifyArchive(bundle) {
  if(bundle?.format!==archiveFormat || !bundle.records || !Array.isArray(bundle.media)) throw Error('Unrecognised Justelle archive');
  const r=bundle.records;
  if(await sha256(new TextEncoder().encode(JSON.stringify(r)))!==bundle.records_sha256) throw Error('Record checksum mismatch');
  verifyRecords(r);
  const files=new Map();
  for(const f of bundle.media) {
    if(!/^[a-f0-9-]{36}(?:-preview)?$/.test(f.id)|| !['image/png','image/jpeg','image/heic','image/heif'].includes(f.mime) || files.has(f.id)) throw Error('Invalid media entry');
    const bytes=base64ToBinary(f.bytes);
    if(bytes.length>12*1024*1024||bytes.length===0||await sha256(bytes)!==f.sha256) throw Error('Media checksum mismatch');
    files.set(f.id,{...f,bytes});
  }
  for(const a of r.attachments) {
    const original=files.get(a.id);
    if(!original || original.sha256!==a.sha256 || original.mime!==a.mime || original.bytes.length!==a.size) throw Error('Missing or mismatched original attachment');
    if(a.preview_path && !files.has(a.id+'-preview')) throw Error('Missing HEIC preview');
  }
  const expected=new Set(r.attachments.flatMap(a=>a.preview_path?[a.id,a.id+'-preview']:[a.id]));
  if([...files.keys()].some(id=>!expected.has(id)))throw Error('Unreferenced media in archive');
  return {records:Object.fromEntries([...recordKinds,...optionalRecordKinds.filter(k=>r[k])].map(k=>[k,r[k].length])),files:files.size,bytes:[...files.values()].reduce((sum,f)=>sum+f.bytes.length,0)};
}

// Shared provider-neutral relationship checks; encrypted backups keep binary media separate.
export function verifyRecords(r) {
  for(const kind of [...recordKinds,...optionalRecordKinds.filter(k=>r[k])]) {
    if(!Array.isArray(r[kind])) throw Error('Missing records: '+kind);
    namesAreUnique(r[kind],kind);
  }
  const idset=kind=>new Set(r[kind].map(x=>x.id));
  const persons=idset('persons'),conversations=idset('conversations'),messages=idset('messages'),decisions=idset('decisions'),adventures=idset('adventures'),attachments=idset('attachments');
  for(const c of r.conversations) {
    if(c.kind==='adventure') {
      requireLink(c.adventure_id,adventures,'conversation adventure');
      if(r.adventures.find(a=>a.id===c.adventure_id)?.conversation_id!==c.id) throw Error('Conversation/adventure mismatch');
    }
  }
  for(const m of r.messages) {
    requireLink(m.conversation_id,conversations,'conversation',true);
    if(m.author_id!=='ai-mock') requireLink(m.author_id,persons,'author',true);
    requireLink(m.adventure_id,adventures,'adventure');
    for(const aid of m.attachment_ids||[]) requireLink(aid,attachments,'message attachment');
    requireLink(m.source_message_id,messages,'AI source');
    requireLink(m.corrects_id,messages,'corrected message');
    if(m.corrects_id){
      const original=r.messages.find(x=>x.id===m.corrects_id);
      if(original.id===m.id||original.author_id!==m.author_id||original.conversation_id!==m.conversation_id)throw Error('Invalid correction relationship');
    }
  }
  const confirmedReplacements=new Set();
  for(const d of r.decisions) {
    if(d.status==='locked' && d.replaces_id) {
      if(confirmedReplacements.has(d.replaces_id))
        throw Error('Conflicting locked revisions of the same plan');
      confirmedReplacements.add(d.replaces_id);
    }
    requireLink(d.conversation_id,conversations,'decision conversation',true);
    if(d.author_id!=='ai-mock') requireLink(d.author_id,persons,'decision author',true);
    requireLink(d.adventure_id,adventures,'decision adventure');
    requireLink(d.source_message_id,messages,'proposal source');
    requireLink(d.replaces_id,decisions,'replaced decision');
    if(d.replaces_id && r.decisions.find(x=>x.id===d.replaces_id)?.status!=='locked') throw Error('Replacement must link to locked original');
    if(!['proposed','locked','declined'].includes(d.status)) throw Error('Invalid decision status');
    if(d.declined_by) requireLink(d.declined_by,persons,'person who declined');
    if(d.status==='declined' && !d.declined_by) throw Error('Declined plan needs an attributable person');
    if(d.status==='declined' && d.locked_at) throw Error('A declined plan cannot be locked');
    if(d.status==='locked' && d.declined_by) throw Error('A locked plan cannot be declined');
    const votes=d.approvals||[];
    if(!Array.isArray(votes) || new Set(votes.map(v=>v.person_id)).size!==votes.length || votes.some(v=>!persons.has(v.person_id))) throw Error('Invalid approvals');
    if(d.status==='locked' && (votes.length!==2 || !d.locked_at)) throw Error('Locked decision needs both approvals');
  }
  for(const d of r.decisions){
    const visited=new Set([d.id]);let current=d;
    while(current.replaces_id){
      if(visited.has(current.replaces_id))throw Error('Cyclic agreement revision history');
      visited.add(current.replaces_id);const previous=r.decisions.find(x=>x.id===current.replaces_id);
      if(previous.conversation_id!==current.conversation_id)throw Error('Agreement revision crosses discussions');
      current=previous;
    }
  }
  for(const m of r.messages){
    const visited=new Set([m.id]);let current=m;
    while(current.corrects_id){
      if(visited.has(current.corrects_id))throw Error('Cyclic correction history');
      visited.add(current.corrects_id);current=r.messages.find(x=>x.id===current.corrects_id);
    }
  }
  for(const a of r.adventures) {
    requireLink(a.conversation_id,conversations,'adventure conversation',true);
    requireLink(a.author_id,persons,'adventure author',true);
    requireLink(a.source_message_id,messages,'adventure source');
    if(!['idea','plan','experience','memory'].includes(a.phase)||!Array.isArray(a.phases)||a.phases.some(p=>!['idea','plan','experience','memory'].includes(p))||a.phases.at(-1)!==a.phase) throw Error('Invalid adventure history');
  }
  for(const a of r.attachments)requireLink(a.author_id,persons,'attachment author',true);
  const events=new Map((r.adventure_events||[]).map(e=>[e.id,e]));
  const visited=new Set();
  for(const a of r.adventures){
    if(!a.last_event_id)continue; // Legacy pilot history remains readable.
    let id=a.last_event_id;const chain=[],seen=new Set();
    while(id){
      const e=events.get(id);
      if(!e||e.adventure_id!==a.id||seen.has(id)||!persons.has(e.author_id)||!e.created_at)throw Error('Broken adventure event history');
      seen.add(id);visited.add(id);chain.unshift(e.phase);
      const prior=e.prior_phases||[];
      if(!Array.isArray(prior)||(e.previous_id&&prior.length))throw Error('Invalid legacy adventure history');
      if(!e.previous_id)chain.unshift(...prior);
      id=e.previous_id;
    }
    if(JSON.stringify(chain)!==JSON.stringify(a.phases))throw Error('Adventure event history mismatch');
  }
  if(visited.size!==events.size)throw Error('Unreferenced adventure event');
  return Object.fromEntries([...recordKinds,...optionalRecordKinds.filter(k=>r[k])].map(k=>[k,r[k].length]));
}
