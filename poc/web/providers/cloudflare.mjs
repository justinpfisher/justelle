export function cloudflareBackend({auth,room}){
 // A Cloudflare production Worker validates signed Firebase ID tokens. Auth-emulator
 // tokens are unsigned, so this adapter cannot be fully exercised in a local
 // browser against a real production verifier; see signed JWT API tests.
 async function call(path,method='GET',data,headers={}){
  const token=await auth.currentUser.getIdToken();
  const response=await fetch('/api/'+path,{method,headers:{Authorization:`Bearer ${token}`,...headers},body:data});
  if(!response.ok) throw Error(`Request refused (${response.status})`);
  return response.json();
 }
 return {
  messages:()=>call('messages'),
  async decisions(){const me=await call('me');return (await call('decisions')).map(d=>({...d,approvals:{...Object.fromEntries(d.approvedBy.map(id=>[id,true])),...(d.approvedBy.includes(me.personId)?{[auth.currentUser.uid]:true}:{})}}));},
  addMessage:(_,body)=>call('messages','POST',JSON.stringify({body}),{'Content-Type':'application/json'}),
  propose:(_,body)=>call('decisions','POST',JSON.stringify({body}),{'Content-Type':'application/json'}),
  approve:(_,d)=>call(`decisions/${d.id}/approve`,'POST'),
  addPhoto:(_,file)=>call('media','POST',file,{'Content-Type':file.type})
 };
}
