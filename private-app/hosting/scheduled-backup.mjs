import {mkdtemp,rm,stat,open,readFile} from 'node:fs/promises';
import {createReadStream} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createHash,randomUUID} from 'node:crypto';
import {firebaseBackupSource} from '../memory/firebase-backup-source.mjs';
import {writeEncryptedBackup,restoreEncryptedBackup} from '../memory/encrypted-backup.mjs';
import {createB2Store,hasB2VersionId} from './functions/b2-store.mjs';
import {qualificationExerciseArchiveName,requireScheduledBackupTarget} from './backup-target.mjs';
async function checksum(path){const hash=createHash('sha256');for await(const chunk of createReadStream(path))hash.update(chunk);return hash.digest('hex');}
export async function runScheduledBackup({db,bucket,roomId,productionApproved=false,config,store=null,source=null,progress=null,
  qualificationExercise=null}){
  const tracked=async(check,work)=>{
    progress?.startSubcheck(check);
    try{
      const result=await work();
      progress?.completeSubcheck(check);
      return result;
    }catch(error){
      progress?.failSubcheck(check,error);
      throw error;
    }
  };
  // Never read a production snapshot or upload it against a fictional B2 target (or vice versa).
  let exerciseName;
  const ownsOccurrence=await tracked('BACKUP_TARGET_VALIDATION',async()=>{
    requireScheduledBackupTarget(config,productionApproved);
    if(qualificationExercise===null)return true;
    if(productionApproved||typeof qualificationExercise?.claim!=='function')
      throw Error('Qualification backup exercise requires an authorized occurrence claim');
    exerciseName=qualificationExerciseArchiveName(qualificationExercise.jobName,qualificationExercise.scheduledTime);
    // A claim must acknowledge one durable create. An unclear response cannot start a worker.
    const claimed=await qualificationExercise.claim(exerciseName);
    if(typeof claimed!=='boolean')throw Error('Qualification backup occurrence claim outcome is unknown');
    return claimed;
  });
  if(!ownsOccurrence)return {verified:false,duplicate:true};
  const key=await tracked('BACKUP_RECOVERY_KEY_VALIDATION',()=>{
    const decoded=Buffer.from(config.recoveryKeyBase64||'','base64');
    if(decoded.length!==32||!/^[a-zA-Z0-9-]{1,80}$/.test(config.prefix||''))throw Error('Independent backup key and prefix are required');
    return decoded;
  });
  const work=await tracked('BACKUP_LOCAL_WORKSPACE',()=>mkdtemp(join(tmpdir(),'justelle-backup-')));
  const destination=join(work,'snapshot.jmb'),downloaded=join(work,'downloaded.jmb');
  let remote;
  try{
    remote=await tracked('BACKUP_STORE_SETUP',()=>store||createB2Store(config));
    if(exerciseName)await tracked('BACKUP_RETENTION_PREFLIGHT',()=>remote.verifyRetention(30));
    // The scheduler is read-only against Firebase; it never edits source history.
    const snapshot=await tracked('BACKUP_FIREBASE_SNAPSHOT',()=>source||firebaseBackupSource({db,bucket,roomId,productionApproved}));
    await tracked('BACKUP_ENCRYPTION',()=>writeEncryptedBackup({...snapshot,key},destination));
    const size=await tracked('BACKUP_SIZE_LIMIT',async()=>{
      const result=(await stat(destination)).size;
      if(result>128*1024*1024)throw Error('Backup exceeds the qualified 128 MiB scheduled snapshot limit');
      return result;
    });
    // The downloaded object is independently restored below; a second local
    // restore of the identical bytes adds no recovery assurance.
    if(!exerciseName)await tracked('BACKUP_RETENTION_PREFLIGHT',()=>remote.verifyRetention());
    const name=exerciseName??(config.prefix+'/'+new Date().toISOString().replace(/[:.]/g,'-')+'-'+randomUUID()+'.jmb');
    const versionId=await tracked('BACKUP_UPLOAD',async()=>{
      if(!exerciseName)return remote.put(name,destination,size);
      let uploadedVersion;
      try{
        uploadedVersion=await remote.put(name,destination,size);
      }catch(error){
        // A reset can hide a successful write. Reconcile once without reissuing PUT.
        if(error?.code!=='ECONNRESET'||error.$metadata?.httpStatusCode)throw error;
      }
      const version=hasB2VersionId(uploadedVersion)?uploadedVersion:await remote.findUploadedVersion(name,size);
      if(!hasB2VersionId(version))throw Error('B2 upload outcome is unknown');
      return version;
    });
    // A default bucket rule is insufficient: require the uploaded version
    // itself to report future governance retention before counting recovery.
    await tracked('BACKUP_OBJECT_RETENTION',()=>remote.verifyObjectRetention(name,versionId));
    let received=0;
    await tracked('BACKUP_DOWNLOAD',async()=>{
      const handle=await open(downloaded,'wx',0o600);
      try{
        for await(const chunk of await remote.get(name,exerciseName?versionId:undefined)){
          received+=chunk.length;if(received>size)throw Error('Downloaded backup exceeds its expected size');
          await handle.writeFile(chunk);
        }
        await handle.sync();
      }finally{await handle.close();}
    });
    await tracked('BACKUP_DOWNLOAD_CHECKSUM',async()=>{
      if(received!==size||await checksum(downloaded)!==await checksum(destination))throw Error('Remote backup checksum mismatch');
    });
    const result=await tracked('BACKUP_DECRYPTION_RESTORE',()=>restoreEncryptedBackup(downloaded,key,join(work,'remote-restore')));
    const recovered=await tracked('BACKUP_RESTORED_RECORDS_READ',async()=>JSON.parse(await readFile(join(work,'remote-restore','records.json'),'utf8')));
    await tracked('BACKUP_RECORDS_MATCH',()=>{
      if(JSON.stringify(recovered)!==JSON.stringify(snapshot.records))throw Error('Restored history differs from the snapshot');
    });
    return {verified:true,files:result.files,bytes:size};
  }finally{
    await tracked('BACKUP_LOCAL_CLEANUP',async()=>{key.fill(0);remote?.close?.();await rm(work,{recursive:true,force:true});});
  }
}
