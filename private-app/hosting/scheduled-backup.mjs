import {mkdtemp,rm,stat,open,readFile} from 'node:fs/promises';
import {createReadStream} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createHash,randomUUID} from 'node:crypto';
import {firebaseBackupSource} from '../memory/firebase-backup-source.mjs';
import {writeEncryptedBackup,restoreEncryptedBackup} from '../memory/encrypted-backup.mjs';
import {createB2Store} from './functions/b2-store.mjs';
import {requireScheduledBackupTarget} from './backup-target.mjs';
async function checksum(path){const hash=createHash('sha256');for await(const chunk of createReadStream(path))hash.update(chunk);return hash.digest('hex');}
export async function runScheduledBackup({db,bucket,roomId,productionApproved=false,config,store=null,source=null}){
  // Never read a production snapshot or upload it against a fictional B2 target (or vice versa).
  requireScheduledBackupTarget(config,productionApproved);
  const key=Buffer.from(config.recoveryKeyBase64||'','base64');
  if(key.length!==32||!/^[a-zA-Z0-9-]{1,80}$/.test(config.prefix||''))throw Error('Independent backup key and prefix are required');
  const work=await mkdtemp(join(tmpdir(),'justelle-backup-'));
  const destination=join(work,'snapshot.jmb'),downloaded=join(work,'downloaded.jmb');
  let remote;
  try{
    remote=store||createB2Store(config);
    // The scheduler is read-only against Firebase; it never edits source history.
    const snapshot=source||await firebaseBackupSource({db,bucket,roomId,productionApproved});
    await writeEncryptedBackup({...snapshot,key},destination);
    const size=(await stat(destination)).size;
    if(size>128*1024*1024)throw Error('Backup exceeds the qualified 128 MiB scheduled snapshot limit');
    // The downloaded object is independently restored below; a second local
    // restore of the identical bytes adds no recovery assurance.
    await remote.verifyRetention();
    const name=config.prefix+'/'+new Date().toISOString().replace(/[:.]/g,'-')+'-'+randomUUID()+'.jmb';
    const versionId=await remote.put(name,destination,size);
    // A default bucket rule is insufficient: require the uploaded version
    // itself to report future governance retention before counting recovery.
    await remote.verifyObjectRetention(name,versionId);
    const handle=await open(downloaded,'wx',0o600);let received=0;
    try{
      for await(const chunk of await remote.get(name)){
        received+=chunk.length;if(received>size)throw Error('Downloaded backup exceeds its expected size');
        await handle.writeFile(chunk);
      }
      await handle.sync();
    }finally{await handle.close();}
    if(received!==size||await checksum(downloaded)!==await checksum(destination))throw Error('Remote backup checksum mismatch');
    const result=await restoreEncryptedBackup(downloaded,key,join(work,'remote-restore'));
    const recovered=JSON.parse(await readFile(join(work,'remote-restore','records.json'),'utf8'));
    if(JSON.stringify(recovered)!==JSON.stringify(snapshot.records))throw Error('Restored history differs from the snapshot');
    return {verified:true,files:result.files,bytes:size};
  }finally{key.fill(0);remote?.close?.();await rm(work,{recursive:true,force:true});}
}
