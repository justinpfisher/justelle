// Provider interface: { respond({message,images,context}) => {reply,proposal?} }.
// Images include original bytes and MIME; a future vision provider can inspect them.
// The test provider never calls a network model and NEVER claims to see image contents.
export const deterministicProvider={
  name:'deterministic-local',
  async respond({message,images}) {
    const imageText=images.length?(' I received '+images.length+' original image'+(images.length===1?'':'s')+' securely, but this test AI does not interpret pixels.'):'';
    const trimmed=message.body.trim().slice(0,140);
    const reply='Fictional test assistant: I can help explore this idea: "'+trimmed+'".'+imageText+' No decision has been made.';
    const wantsProposal=/(plan|suggest|could|should|what if|idea|\?)/i.test(message.body);
    const proposal=wantsProposal?{
      body:'Fictional suggestion to explore: '+trimmed,
      why:'Drafted by the deterministic local test assistant; requires two human approvals.'
    }:null;
    return {reply,proposal};
  }
};
export function chooseProvider(name='deterministic-local') {
  if(name==='deterministic-local') return deterministicProvider;
  throw Error('No paid AI provider is enabled. Provider activation requires explicit budget and credentials.');
}
