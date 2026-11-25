import {AsyncLocalStorage} from 'node:async_hooks';
import {onSchedule} from 'firebase-functions/v2/scheduler';
import {qualificationBackupJob,qualificationExerciseArchiveName} from '../backup-target.mjs';
import {runScheduledBackup} from '../scheduled-backup.mjs';

export function createScheduledBackupTrigger(options,{runtime,getFirestore,getBucket,readConfig,getExerciseSlot,version,
  runBackup=runScheduledBackup,logger=console}){
  const requestHeaders=new AsyncLocalStorage();
  const scheduled=onSchedule(options,async()=>{
    let result;
    try{
      const {roomId,environment}=runtime();
      const productionApproved=environment==='production';
      const slot=productionApproved?'':getExerciseSlot();
      const invocation=requestHeaders.getStore();
      if(slot&&qualificationExerciseArchiveName(invocation?.jobName,invocation?.scheduledTime)!==
        qualificationExerciseArchiveName(qualificationBackupJob,slot))throw Error('Unapproved Qualification backup occurrence');
      const db=getFirestore();
      const qualificationExercise=slot?{
        ...invocation,
        async claim(archiveName){
          const claimId=archiveName.split('/').at(-1);
          try{
            await db.doc(`qualification_backup_occurrences/${claimId}`).create({started:true});
            return true;
          }catch(error){
            if(error?.code===6||error?.code==='already-exists')return false;
            throw error;
          }
        }
      }:null;
      result=await runBackup({db,bucket:getBucket(),roomId,productionApproved,config:readConfig(),qualificationExercise});
      if(result.verified)logger.info(JSON.stringify({event:'encrypted_backup_verified',version}));
    }catch{
      // Preserve the failure metric without exposing request, archive or provider details.
      logger.error(JSON.stringify({event:'encrypted_backup_failed',version}));
      throw Error('Encrypted backup failed; review private provider monitoring');
    }
    if(result.duplicate)throw Error('Qualification backup occurrence is already claimed');
  });
  // Cloud Run authenticates the caller. Capture service-generated headers before the SDK
  // can replace a missing schedule time with its clock. Keep the SDK endpoint metadata.
  return Object.assign((request,response)=>requestHeaders.run({
    jobName:request.header('X-CloudScheduler-JobName'),
    scheduledTime:request.header('X-CloudScheduler-ScheduleTime')
  },()=>scheduled(request,response)),scheduled);
}
