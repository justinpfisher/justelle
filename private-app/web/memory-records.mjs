// Canonical Justelle records: account UIDs never become permanent person IDs.
import {GENERAL_CONVERSATION} from './topics.mjs';
const asISO=t=>typeof t==='string'?t:(t?.toDate?.()?.toISOString()||null);
export function canonicalRecords({membership,messages,decisions,adventures,attachments,events=[]}) {
      const uidPerson=uid=>membership.people[uid];
      const topics=[{id:GENERAL_CONVERSATION,kind:'shared',adventure_id:null},
        ...adventures.filter(a=>a.conversation_id!==GENERAL_CONVERSATION).map(a=>({
          id:a.conversation_id,kind:'adventure',adventure_id:a.id,title:a.title
        }))];
      return {
        persons:membership.uids.map(uid=>({id:uidPerson(uid),label:membership.labels?.[uid]||'Fictional member'})),
        conversations:topics,
        messages:messages.map(m=>({
          id:m.id,body:m.body,author_id:m.author_id,kind:m.kind,
          conversation_id:m.conversation_id,adventure_id:m.adventure_id??null,
          source_message_id:m.source_message_id??null,corrects_id:m.corrects_id??null,
          attachment_ids:m.attachment_ids||[],created_at:asISO(m.created_at)
        })),
        decisions:decisions.map(d=>({
          id:d.id,body:d.body,why:d.why||'',author_id:d.author_id,origin:d.origin,
          conversation_id:d.conversation_id,adventure_id:d.adventure_id??null,
          source_message_id:d.source_message_id??null,replaces_id:d.replaces_id??null,
          status:d.status,created_at:asISO(d.created_at),locked_at:asISO(d.locked_at),
          declined_by:d.declined_by||null,declined_at:asISO(d.declined_at),
          approvals:Object.keys(d.approvals||{}).map(uid=>({person_id:uidPerson(uid),at:asISO(d.approval_times?.[uid])}))
        })),
        adventures:adventures.map(a=>({
          id:a.id,title:a.title,phase:a.phase,phases:a.phases,author_id:a.author_id,
          last_event_id:a.last_event_id||null,last_modified_by:a.last_modified_by,source_message_id:a.source_message_id,
          conversation_id:a.conversation_id,created_at:asISO(a.created_at),updated_at:asISO(a.updated_at)
        })),
        adventure_events:events.map(e=>({id:e.id,adventure_id:e.adventure_id,phase:e.phase,previous_id:e.previous_id,prior_phases:e.prior_phases||[],author_id:e.author_id,created_at:asISO(e.created_at)})),
        attachments:attachments.map(a=>({
          id:a.id,name:a.name,mime:a.mime,size:a.size,sha256:a.sha256,author_id:a.author_id,
          created_at:asISO(a.created_at),preview_path:a.preview_path?'media/'+a.id+'-preview':null
        }))
      };
}
