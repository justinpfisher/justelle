// Canonical conversation names are provider-independent and stable over time.
// The shared chat is one conversation; every adventure gets its own conversation.
export const GENERAL_CONVERSATION='conversation-shared';
export function topicConversation(adventureId) {
  if(typeof adventureId!=='string'||!/^[a-zA-Z0-9-]{1,140}$/.test(adventureId))
    throw Error('Invalid adventure reference');
  return 'conversation-'+adventureId;
}
export function contextFor(adventureId=null) {
  return adventureId?{adventureId,conversationId:topicConversation(adventureId)}:
    {adventureId:null,conversationId:GENERAL_CONVERSATION};
}
export function decisionView(decisions,conversationId) {
  const scoped=decisions.filter(d=>d.conversation_id===conversationId);
  const byId=new Map(scoped.map(d=>[d.id,d]));
  const replacements=new Map();
  for(const d of scoped) {
    if(d.status!=='locked'||!d.replaces_id||!byId.has(d.replaces_id))continue;
    const list=replacements.get(d.replaces_id)||[];
    list.push(d);replacements.set(d.replaces_id,list);
  }
  const current=[],history=[],unresolved=[];
  for(const d of scoped) {
    const replacedBy=replacements.get(d.id)||[];
    const entry={...d,superseded_by:replacedBy.map(x=>x.id),conflict:replacedBy.length>1};
    if(d.status==='locked' && replacedBy.length)history.push(entry);
    else if(d.status==='declined')history.push(entry);
    else if(d.status==='locked')current.push(entry);
    else unresolved.push(entry);
  }
  const byNewest=(a,b)=>(b.created_at?.toMillis?.()||0)-(a.created_at?.toMillis?.()||0);
  return {current:current.sort(byNewest),history:history.sort(byNewest),unresolved:unresolved.sort(byNewest),
    hasConflict:[...replacements.values()].some(list=>list.length>1)};
}
