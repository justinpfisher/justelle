import {resolveRuntime} from '../web/runtime-config.mjs';
export function buildEnvironment(c){
  if(!['hosted-fictional','production'].includes(c.mode)||c.projectId===c.otherProjectId||
    !/^[a-z][a-z0-9-]{4,28}[a-z0-9]$/.test(c.otherProjectId||'')||
    !/^[a-z0-9-]{4,63}$/.test(c.site||''))throw Error('Separate deployment projects and site are required');
  const expectedProjects=c.mode==='hosted-fictional'
    ? {projectId:'justelle-qualification',otherProjectId:'justelle-production'}
    : {projectId:'justelle-production',otherProjectId:'justelle-qualification'};
  if(c.projectId!==expectedProjects.projectId||c.otherProjectId!==expectedProjects.otherProjectId)
    throw Error('Deployment mode does not match its dedicated Justelle project pair');
  if(c.mode==='hosted-fictional'&&
    (c.site!=='justelle-qualification'||c.origin!=='https://justelle-qualification.web.app'))
    throw Error('Fictional deployment must use the isolated qualification Hosting site');
  const env={VITE_JUSTELLE_MODE:c.mode,VITE_JUSTELLE_ORIGIN:c.origin,VITE_JUSTELLE_ROOM:c.roomId,
    VITE_FIREBASE_PROJECT_ID:c.projectId,VITE_FIREBASE_AUTH_DOMAIN:c.projectId+'.firebaseapp.com',
    VITE_FIREBASE_STORAGE_BUCKET:c.projectId+'.firebasestorage.app',VITE_FIREBASE_API_KEY:c.apiKey,
    VITE_JUSTELLE_QUALIFICATION_PROJECT_ID:c.mode==='production'?c.otherProjectId:c.projectId};
  resolveRuntime({origin:c.origin,env});
  for(const value of [c.gatewayServiceAccount,c.backupServiceAccount])
    if(!new RegExp('^[a-z][a-z0-9-]{4,28}@'+c.projectId+'\\.iam\\.gserviceaccount\\.com$').test(value||''))
      throw Error('Deployment identities must belong to the selected Justelle project');
  return env;
}
export function functionEnvironment(c){
  buildEnvironment(c);
  return Object.entries({JUSTELLE_MODE:c.mode,JUSTELLE_ROOM_ID:c.roomId,JUSTELLE_ORIGIN:c.origin,
    JUSTELLE_GATEWAY_SERVICE_ACCOUNT:c.gatewayServiceAccount,JUSTELLE_BACKUP_SERVICE_ACCOUNT:c.backupServiceAccount})
    .map(([k,v])=>k+'='+JSON.stringify(v)).join('\n')+'\n';
}
