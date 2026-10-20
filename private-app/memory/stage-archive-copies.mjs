// Outgoing-only Windows-friendly archive staging. Does NOT establish OneDrive
// cloud verification, deletion permission or replacement for live backups.
import {createHash} from 'node:crypto';
import {createReadStream} from 'node:fs';
import {copyFile,mkdtemp,link,unlink,rm,stat,lstat,realpath} from 'node:fs/promises';
import {resolve,join,sep} from 'node:path';
import {restoreEncryptedBackup} from './encrypted-backup.mjs';

async function checksum(path){
  const hash=createHash('sha256');
  for await(const chunk of createReadStream(path))hash.update(chunk);
  return hash.digest('hex');
}
async function absent(path){
  // lstat also detects a dangling link, which stat would treat as missing.
  try{await lstat(path);throw Error('Archive copy already exists: do not overwrite a sealed generation');}
  catch(error){if(error.code!=='ENOENT')throw error;}
}
function inside(parent,child){return child===parent||child.startsWith(parent+sep);}
export async function stageArchiveCopies({source,key,archiveId,localDir,oneDriveDir}){
  if(!/^[a-zA-Z0-9_-]{1,96}$/.test(archiveId||''))
    throw Error('Use a stable archive identifier');
  if(!(key instanceof Uint8Array)||key.byteLength!==32)
    throw Error('Separate 32-byte archive recovery key required');
  // Check both requested and resolved paths. A symlink/junction can make two
  // apparently separate Windows folders point at the same directory, or into
  // the source/OneDrive tree. Staging there is not independent preservation.
  const requestedSource=resolve(source),requestedLocal=resolve(localDir),
    requestedSync=resolve(oneDriveDir);
  const [src,local,sync]=await Promise.all([
    realpath(requestedSource),realpath(requestedLocal),realpath(requestedSync)
  ]);
  const overlaps=(a,b,c)=>inside(a,b)||inside(b,a)||inside(a,c);
  if(overlaps(requestedLocal,requestedSync,requestedSource)||
     inside(requestedSync,requestedSource)||
     overlaps(local,sync,src)||inside(sync,src))
    throw Error('Archive source, non-sync copy and OneDrive destination must be independent paths');
  // Require existing owner-managed directories: do not invent/switch cloud accounts.
  const [localInfo,syncInfo]=await Promise.all([stat(local),stat(sync)]);
  if(!localInfo.isDirectory()||!syncInfo.isDirectory())
    throw Error('Archive destinations must be existing directories');
  const filename='justelle-'+archiveId+'.jmb',one=join(local,filename),two=join(sync,filename);
  await absent(one);await absent(two);
  const digest=await checksum(src);
  const staging=[];
  const published=[];
  try{
    for(const [dir,destination] of [[local,one],[sync,two]]){
      const temp=await mkdtemp(join(dir,'.justelle-archive-'));staging.push(temp);
      const encrypted=join(temp,filename);
      await copyFile(src,encrypted);
      if(await checksum(encrypted)!==digest)throw Error('Copied ciphertext checksum mismatch');
      // Genuine independent restore from the copied bytes; this checks original
      // records, complete media and authentication before announcing staged copy.
      await restoreEncryptedBackup(encrypted,key,join(temp,'verified-restore'));
      await rm(join(temp,'verified-restore'),{recursive:true,force:true});
      await absent(destination);
      // Hard-link a fully verified, same-volume staged file into place. Unlike
      // rename(), link() fails with EEXIST when another process has published
      // the same generation in the meantime. The staging directory is local
      // to its destination so cross-volume hard-linking is never needed.
      await link(encrypted,destination);published.push(destination);
      await unlink(encrypted);
    }
    return {archive_id:archiveId,sha256:digest,local_copy:one,
      synced_folder_copy:two,local_restore_verified:true,sync_folder_restore_verified:true,
      remote_cloud_restore_verified:false,safe_to_delete_source:false,
      caution:'OneDrive sync folder restore is not verification of independent Microsoft cloud recovery.'};
  }catch(error){
    for(const file of published)await rm(file,{force:true}).catch(()=>{});
    throw error;
  }finally{
    for(const folder of staging)await rm(folder,{recursive:true,force:true}).catch(()=>{});
  }
}
