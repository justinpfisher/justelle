export async function smoke({origin,projectId,roomId,apiKey,members,sha},fetchImpl=fetch){
  const request=async(url,options,allowed)=>{
    const result=await fetchImpl(url,{redirect:'error',cache:'no-store',signal:AbortSignal.timeout(20000),...options});
    if(!allowed.includes(result.status)){await result.body?.cancel();throw Error('Release access check failed');}
    return result;
  };
  const health=await request(origin+'/api/healthz',{},[200]);
  if((await health.json()).version!==sha)throw Error('Hosted source version differs');
  for(const path of ['/','/manifest.webmanifest','/justelle-caricature.png']){
    const result=await request(origin+path,{},[200]);await result.body?.cancel();
  }
  const id='00000000-0000-4000-8000-000000000001';
  const anonymousImage=await request(origin+'/api/media/'+id+'/original',{},[401]);await anonymousImage.body?.cancel();
  const anonymousAI=await request(origin+'/api/respond',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({source_message_id:id})},[401]);await anonymousAI.body?.cancel();
  const missingPlan=crypto.randomUUID(),missingSource=crypto.randomUUID();
  const proposal={plan_id:missingPlan,revision:0,source_id:missingSource};
  const anonymousPlanner=await request(origin+'/api/plan/suggest',{
    method:'POST',headers:{'Content-Type':'application/json'},
    body:JSON.stringify(proposal)},[401]);await anonymousPlanner.body?.cancel();
  const anonymousDocument=await request(origin+'/api/media/documents/'+id,{},[401]);
  await anonymousDocument.body?.cancel();
  if(!Array.isArray(members)||members.length!==2)throw Error('Two private member smoke identities are required');
  for(const member of members){
    const login=await request('https://identitytoolkit.googleapis.com/v1/accounts:signInWithPassword?key='+encodeURIComponent(apiKey),{
      method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({email:member.email,password:member.password,returnSecureToken:true})},[200]);
    const identity=await login.json();
    try{
      const records='https://firestore.googleapis.com/v1/projects/'+projectId+
        '/databases/(default)/documents/rooms/'+roomId;
      const authorized={Authorization:'Bearer '+identity.idToken};
      const room=await request(records,{headers:authorized},[200]);await room.body?.cancel();
      const plans=await request(records+'/adventure_plans?pageSize=1',
        {headers:authorized},[200]);await plans.body?.cancel();
      // Both gateway routes must authorize a real member. Nonexistent UUIDs
      // fail at source lookup before the model, so no paid call or write occurs.
      const ai=await request(origin+'/api/respond',{
        method:'POST',headers:{...authorized,'Content-Type':'application/json'},
        body:JSON.stringify({source_message_id:missingSource})},[404]);
      await ai.body?.cancel();
      const planner=await request(origin+'/api/plan/suggest',{
        method:'POST',headers:{...authorized,'Content-Type':'application/json'},
        body:JSON.stringify(proposal)},[404]);
      await planner.body?.cancel();
    }finally{identity.idToken=null;identity.refreshToken=null;}
  }
}
