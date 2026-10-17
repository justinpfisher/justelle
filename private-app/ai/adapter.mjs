// Replaceable AI interface. The local provider cannot answer factual or image
// questions and intentionally never makes claims about the pixels in an image.
// A production provider is not enabled and requires a separate usage budget.
function explicitPlanRequest(text) {
  return /\b(?:suggest|propose|draft|create|make|prepare|write)\s+(?:(?:us|me)\s+)?(?:(?:a|an|the|new|our|different)\s+)?(?:plan|proposal)\b/i.test(text) ||
    /\b(?:turn this into|make this)\s+(?:a\s+)?plan\b/i.test(text);
}
export const deterministicProvider={
  name:'deterministic-local',
  async respond({message,images=[],context={}}) {
    const planning=explicitPlanRequest(message.body);
    const attached=images.length;
    if(planning) return {
      reply:'I’ve prepared a fictional suggestion for this discussion. You can both look it over and decide whether it works.',
      proposal:{
        body:'Demo suggestion: '+message.body.trim().slice(0,160),
        why:'This is only a test suggestion. It becomes your shared plan if you both agree.'
      }
    };
    if(attached) return {
      reply:'I can confirm '+attached+' image'+(attached===1?' was':'s were')+
        ' attached to this discussion, but this demonstration cannot interpret what the images show. A real image-capable AI will require separate approval.',
      proposal:null
    };
    return {
      reply:'I’m Justelle’s demonstration assistant. I can show how an AI reply appears in this shared conversation, but I can’t answer factual questions yet. A real AI model will be connected only after its usage and costs are approved.',
      proposal:null
    };
  }
};
export function chooseProvider(name='deterministic-local') {
  if(name==='deterministic-local') return deterministicProvider;
  throw Error('No paid AI provider is enabled. Provider activation requires explicit budget and credentials.');
}
