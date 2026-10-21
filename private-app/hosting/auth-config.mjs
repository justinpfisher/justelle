const updateMask='signIn.email.enabled,signIn.email.passwordRequired,signIn.anonymous.enabled,signIn.phoneNumber.enabled';
export async function enforceAuthConfig(projectId,{credential,fetchImpl=fetch}={}){
  if(!/^[a-z][a-z0-9-]{4,28}[a-z0-9]$/.test(projectId||''))throw Error('Invalid Auth project');
  const token=await credential.getAccessToken();
  const url=new URL(`https://identitytoolkit.googleapis.com/admin/v2/projects/${projectId}/config`);
  url.searchParams.set('updateMask',updateMask);
  const response=await fetchImpl(url,{method:'PATCH',redirect:'error',signal:AbortSignal.timeout(15000),
    headers:{authorization:`Bearer ${token.access_token}`,'content-type':'application/json','x-goog-user-project':projectId},
    body:JSON.stringify({signIn:{email:{enabled:true,passwordRequired:true},anonymous:{enabled:false},phoneNumber:{enabled:false}}})});
  if(!response.ok)throw Error('Auth configuration update failed');
  const actual=await response.json();
  if(actual.signIn?.email?.enabled!==true||actual.signIn?.email?.passwordRequired!==true||
    actual.signIn?.anonymous?.enabled===true||actual.signIn?.phoneNumber?.enabled===true)
    throw Error('Auth configuration verification failed');
}
