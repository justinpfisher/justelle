// Public client configuration is separate from server credentials.
export function resolveRuntime({hostname,origin,env={}}){
  const mode=env.VITE_JUSTELLE_MODE||'local';
  if(mode==='local'){
    if(!['localhost','127.0.0.1'].includes(hostname))throw Error('This fictional pilot is available locally only.');
    const projectId='demo-justelle-pilot';
    return {mode,roomId:'fictional-room',projectId,aiUrl:'http://127.0.0.1:8787/respond',
      firebase:{apiKey:'emulator-only',projectId,authDomain:projectId+'.firebaseapp.com',storageBucket:projectId+'.firebasestorage.app'}};
  }
  if(!['hosted-fictional','production'].includes(mode))throw Error('Unapproved application mode');
  const approvedOrigin=env.VITE_JUSTELLE_ORIGIN;
  const url=new URL(approvedOrigin||'https://invalid.invalid');
  if(url.protocol!=='https:'||url.origin!==approvedOrigin||url.origin!==origin||
     !(mode==='production'?url.hostname==='app.justelle.life':/^[a-z0-9-]+\.web\.app$/.test(url.hostname)))throw Error('Hosted origin has not been configured for this build');
  const projectId=env.VITE_FIREBASE_PROJECT_ID;
  if(!/^[a-z][a-z0-9-]{4,28}[a-z0-9]$/.test(projectId||'')||projectId.startsWith('demo-')||
     !env.VITE_FIREBASE_API_KEY)throw Error('A separate Firebase project is required');
  const roomId=env.VITE_JUSTELLE_ROOM;
  if(mode==='hosted-fictional'&&roomId!=='fictional-room')throw Error('A separate fictional qualification project is required');
  if(mode==='production'&&(!/^[a-zA-Z0-9-]{1,100}$/.test(roomId||'')||roomId==='fictional-room'||
    !env.VITE_JUSTELLE_QUALIFICATION_PROJECT_ID||projectId===env.VITE_JUSTELLE_QUALIFICATION_PROJECT_ID))
    throw Error('Production must be separate from fictional qualification');
  const authDomain=env.VITE_FIREBASE_AUTH_DOMAIN,bucket=env.VITE_FIREBASE_STORAGE_BUCKET;
  if(authDomain!==projectId+'.firebaseapp.com'||bucket!==projectId+'.firebasestorage.app')throw Error('Firebase configuration does not match the qualification project');
  return {mode,projectId,roomId,aiUrl:origin+'/api/respond',planAiUrl:origin+'/api/plan/suggest',mediaUrl:origin+'/api/media',
    firebase:{apiKey:env.VITE_FIREBASE_API_KEY,projectId,authDomain,storageBucket:bucket}};
}
