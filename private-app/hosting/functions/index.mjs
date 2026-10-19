import {initializeApp} from 'firebase-admin/app';
import {getAuth} from 'firebase-admin/auth';
import {getFirestore,FieldValue} from 'firebase-admin/firestore';
import {getStorage} from 'firebase-admin/storage';
import {onRequest} from 'firebase-functions/v2/https';
import {onSchedule} from 'firebase-functions/v2/scheduler';
import {defineString,defineSecret} from 'firebase-functions/params';
import {createMediaHandler} from '../media-handler.mjs';
import {createApiHandler} from '../api-handler.mjs';
import {createResponseService} from '../../ai/response-service.mjs';
import {deterministicProvider} from '../../ai/adapter.mjs';
import {createVisionProvider} from '../../ai/vision-provider.mjs';
import {createPlannerModelProvider} from '../../ai/planner-model-provider.mjs';
import {createPlannerSuggestionService} from '../../ai/planner-suggestion-service.mjs';
import {FirestoreBudgetLedger} from '../../ai/budget-ledger.mjs';
import {runScheduledBackup} from '../scheduled-backup.mjs';

initializeApp();
const room=defineString('JUSTELLE_ROOM_ID');
const origin=defineString('JUSTELLE_ORIGIN');
const mode=defineString('JUSTELLE_MODE');
const serviceAccount=defineString('JUSTELLE_GATEWAY_SERVICE_ACCOUNT');
const backupAccount=defineString('JUSTELLE_BACKUP_SERVICE_ACCOUNT');
const apiKey=defineSecret('JUSTELLE_AI_KEY');
const backupConfig=defineSecret('JUSTELLE_BACKUP_CONFIG');
// Deployment discovery must succeed without runtime values or secret access.
const version=typeof __JUSTELLE_VERSION__==='string'?__JUSTELLE_VERSION__:'unversioned';
function runtime(){
  const roomId=room.value(),siteOrigin=origin.value(),environment=mode.value();
  const url=new URL(siteOrigin);
  if(url.protocol!=='https:'||url.origin!==siteOrigin||!['hosted-fictional','production'].includes(environment)||
    !/^[a-zA-Z0-9-]{1,100}$/.test(roomId)||
    (environment==='production'?(roomId==='fictional-room'||url.hostname!=='app.justelle.life'):
      (roomId!=='fictional-room'||!/^[a-z0-9-]+\.web\.app$/.test(url.hostname))))throw Error('Invalid private runtime');
  return {roomId,siteOrigin,environment};
}
export const privateApi=onRequest({region:'northamerica-northeast1',memory:'512MiB',timeoutSeconds:120,
  minInstances:0,maxInstances:2,concurrency:10,invoker:'public',serviceAccount,secrets:[apiKey]},async(req,res)=>{
  const {roomId,siteOrigin,environment}=runtime(),db=getFirestore(),bucket=getStorage().bucket();
  const verifyIdentity=(token,options)=>getAuth().verifyIdToken(token,options.checkRevoked);
  const media=createMediaHandler({roomId,bucket,verifyIdentity,readMembership:async id=>(await db.doc('rooms/'+id).get()).data()});
  const rateLimit=async uid=>{
      const ref=db.doc('rooms/'+roomId+'/ai_rate_limits/'+uid);
      await db.runTransaction(async t=>{
        const snap=await t.get(ref),now=Date.now(),r=snap.data();
        const count=r&&now-r.start<60000?r.count:0;
        if(count>=12)throw Object.assign(Error('Rate limit'),{status:429});
        t.set(ref,{start:count?r.start:now,count:count+1});
      });
  };
  const provider=async()=>{
      const settings=(await db.doc('rooms/'+roomId+'/operations/runtime').get()).data();
      if(environment==='hosted-fictional'&&settings?.ai_provider==='deterministic-local')return deterministicProvider;
      if(settings?.ai_enabled!==true||settings.ai_model!=='gpt-5.6-luna')throw Error('AI is disabled');
      return createVisionProvider({approved:true,apiKey:apiKey.value(),model:settings.ai_model,pricing:settings.ai_pricing,
        budget:new FirestoreBudgetLedger({db,roomId,monthlyCadMicros:5000000,dailyCadMicros:1000000})});
  };
  const respond=createResponseService({db,bucket,roomId,verifyIdentity,
    serverTimestamp:()=>FieldValue.serverTimestamp(),rateLimit,provider});
  const plannerProvider=async()=>{
    const settings=(await db.doc('rooms/'+roomId+'/operations/runtime').get()).data();
    if(settings?.ai_enabled!==true||settings.ai_model!=='gpt-5.6-luna')
      throw Error('AI planner is disabled');
    return createPlannerModelProvider({approved:true,apiKey:apiKey.value(),
      model:settings.ai_model,pricing:settings.ai_pricing,
      budget:new FirestoreBudgetLedger({db,roomId,monthlyCadMicros:5000000,dailyCadMicros:1000000})});
  };
  const planSuggest=createPlannerSuggestionService({db,bucket,roomId,
    verifyIdentity,provider:plannerProvider,rateLimit});
  await createApiHandler({media,respond,planSuggest,origin:siteOrigin,version})(req,res);
});
// Separate identity and secrets: the image/AI gateway cannot access recovery keys.
export const encryptedBackup=onSchedule({schedule:'15 3 * * *',timeZone:'America/Toronto',region:'northamerica-northeast1',
  memory:'1GiB',timeoutSeconds:540,minInstances:0,maxInstances:1,concurrency:1,retryCount:0,
  serviceAccount:backupAccount,secrets:[backupConfig]},async()=>{
  const {roomId,environment}=runtime();
  try{
    await runScheduledBackup({db:getFirestore(),bucket:getStorage().bucket(),roomId,
      productionApproved:environment==='production',config:JSON.parse(backupConfig.value())});
    console.info(JSON.stringify({event:'encrypted_backup_verified',version}));
  }catch{
    // Never log source records, provider diagnostics or secret-bearing SDK errors.
    console.error(JSON.stringify({event:'encrypted_backup_failed',version}));
    throw Error('Encrypted backup failed; review private provider monitoring');
  }
});
