// Operator-side fictional-data recovery drill. Keys are separate files, never arguments.
import {readFile,writeFile} from 'node:fs/promises';
import {pathToFileURL} from 'node:url';
import {generateRecoveryKey,writeDirectoryBackup,restoreEncryptedBackup} from './encrypted-backup.mjs';
import {sealArchivedAdventureFromRestore} from './seal-adventure.mjs';

const usage='Usage: node memory/backup-cli.mjs key <new-key-file> | '+
  'backup <key-file> <source-directory> <new-backup> | '+
  'restore <key-file> <backup> <new-directory> | '+
  'seal <key-file> <restored-full-directory> <archived-adventure-id> <new-sealed-backup>';
export async function main(args){
  const [command,keyPath,source,arg4,arg5]=args;
  if(command==='key'&&keyPath&&!source){
    await writeFile(keyPath,generateRecoveryKey(),{flag:'wx',mode:0o600});
    return {recovery_key_created:true};
  }
  if(!keyPath||!source||!arg4||
     (command==='seal'?!arg5:!['backup','restore'].includes(command)||Boolean(arg5)))
    throw Error(usage);
  const key=await readFile(keyPath);
  try{
    if(command==='backup')return await writeDirectoryBackup(source,key,arg4);
    if(command==='restore')return await restoreEncryptedBackup(source,key,arg4);
    return await sealArchivedAdventureFromRestore({restoredDirectory:source,
      adventureId:arg4,key,destination:arg5});
  }finally{key.fill(0);}
}
if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href){
  try{console.log(await main(process.argv.slice(2)));}
  catch(e){console.error(e.message);process.exitCode=1;}
}
