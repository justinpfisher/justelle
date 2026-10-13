// Operator-side fictional-data recovery drill. Keys are separate files, never arguments.
import {readFile,writeFile} from 'node:fs/promises';
import {pathToFileURL} from 'node:url';
import {generateRecoveryKey,writeDirectoryBackup,restoreEncryptedBackup} from './encrypted-backup.mjs';
export async function main(args){
  const [command,keyPath,source,destination]=args;
  if(command==='key'&&keyPath&&!source){await writeFile(keyPath,generateRecoveryKey(),{flag:'wx',mode:0o600});return {recovery_key_created:true};}
  if(!['backup','restore'].includes(command)||!keyPath||!source||!destination)
    throw Error('Usage: node memory/backup-cli.mjs key <new-key-file> | backup <key-file> <source-directory> <new-backup> | restore <key-file> <backup> <new-directory>');
  const key=await readFile(keyPath);
  try{return await (command==='backup'?writeDirectoryBackup(source,key,destination):restoreEncryptedBackup(source,key,destination));}
  finally{key.fill(0);}
}
if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href){
  try{console.log(await main(process.argv.slice(2)));}catch(e){console.error(e.message);process.exitCode=1;}
}
