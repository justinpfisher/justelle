export async function smoke({origin,projectId,roomId,apiKey,members,sha},fetchImpl=fetch){
  const request=async(url,options,allowed)=>{
    const result=await fetchImpl(url,{redirect:'error',cache:'no-store',signal:AbortSignal.timeout(20000),...options});
    if(!allowed.includes(result.status)){await result.body?.cancel();throw Error('Release access check failed');}
    return result;
  };
  const health=await request(origin+'/api/healthz',{},[200]);
  if((await health.json()).version!==sha)throw Error('Hosted source version differs');
  // A healthy API does not prove the protected journey application was deployed.
  const entry=await request(origin+'/',{},[200]);
  const html=await entry.text();
  if(!html.includes('id="login-form"')||!html.includes('id="private-app"')||
     !html.includes('id="planner-create"')||
     !html.includes('rel="apple-touch-icon"'))
    throw Error('Private planner HTML is missing from this release');
  if(!(entry.headers.get('cache-control')||'').includes('no-store')||
     !(entry.headers.get('content-security-policy')||'').includes("frame-ancestors 'none'")||
     !(entry.headers.get('content-security-policy')||'').includes("object-src 'none'"))
    throw Error('Private planner Hosting security headers are missing');
  const manifestResponse=await request(origin+'/manifest.webmanifest',{},[200]);
  const manifest=await manifestResponse.json();
  if(typeof manifest.name!=='string'||!manifest.name.includes('Justelle')||
     manifest.start_url!=='/'||manifest.scope!=='/'||
     manifest.display!=='standalone'||!Array.isArray(manifest.icons)||
     !manifest.icons.some(item=>item.src==='/justelle-caricature.png'))
    throw Error('The private iPhone Home Screen manifest is not configured');
  const artwork=await request(origin+'/justelle-caricature.png',{},[200]);
  await artwork.body?.cancel();
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
  // Two configured logins are not evidence of two distinct real members.
  if(!Array.isArray(members)||members.length!==2||
     members.some(m=>typeof m?.email!=='string'||!m.email.trim()||
       typeof m.password!=='string'||!m.password)||
     new Set(members.map(m=>m.email.trim().toLowerCase())).size!==2)
    throw Error('Two distinct private member smoke identities are required');
  const authenticatedUids=new Set();
  for(const member of members){
    const login=await request('https://identitytoolkit.googleapis.com/v1/accounts:signInWithPassword?key='+encodeURIComponent(apiKey),{
      method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({email:member.email,password:member.password,returnSecureToken:true})},[200]);
    const identity=await login.json();
    try{
      // Email/password REST responses identify the actual Firebase user via localId.
      // Reject two aliases resolving to the same UID before approving the release.
      if(typeof identity.localId!=='string'||!identity.localId||
         authenticatedUids.has(identity.localId)||typeof identity.idToken!=='string'||!identity.idToken)
        throw Error('Two distinct authenticated Firebase member UIDs are required');
      authenticatedUids.add(identity.localId);
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
    }finally{identity.idToken=null;identity.refreshToken=null;identity.localId=null;}
  }
}
