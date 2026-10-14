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
  if(!Array.isArray(members)||members.length!==2)throw Error('Two private member smoke identities are required');
  for(const member of members){
    const login=await request('https://identitytoolkit.googleapis.com/v1/accounts:signInWithPassword?key='+encodeURIComponent(apiKey),{
      method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({email:member.email,password:member.password,returnSecureToken:true})},[200]);
    const identity=await login.json();
    try{
      const record=await request('https://firestore.googleapis.com/v1/projects/'+projectId+'/databases/(default)/documents/rooms/'+roomId,
        {headers:{Authorization:'Bearer '+identity.idToken}},[200]);await record.body?.cancel();
      // Random missing source: verifies authenticated routing without a paid call or real-content write.
      const source=crypto.randomUUID();
      const ai=await request(origin+'/api/respond',{method:'POST',headers:{Authorization:'Bearer '+identity.idToken,'Content-Type':'application/json'},
        body:JSON.stringify({source_message_id:source})},[404]);await ai.body?.cancel();
    }finally{identity.idToken=null;identity.refreshToken=null;}
  }
}
