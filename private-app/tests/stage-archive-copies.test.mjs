import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,mkdir,readFile,readdir,writeFile,stat,symlink} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {writeEncryptedBackup,generateRecoveryKey,restoreEncryptedBackup} from '../memory/encrypted-backup.mjs';
import {stageArchiveCopies} from '../memory/stage-archive-copies.mjs';
const records={
 persons:[{id:'person-a',label:'Fictional A'},{id:'person-b',label:'Fictional B'}],
 conversations:[{id:'conversation-shared',kind:'shared'}],messages:[],decisions:[],adventures:[],attachments:[]
};
async function fixture(){
 const root=await mkdtemp(join(tmpdir(),'justelle-m6-fictional-'));
 const one=join(root,'offline'),two=join(root,'onedrive'),src=join(root,'source.jmb');
 await mkdir(one);await mkdir(two);
 const key=generateRecoveryKey();
 await writeEncryptedBackup({records,media:[],key},src);
 return {root,src,one,two,key};
}
test('Stage two unchanged ciphertext copies, independently restore each and NEVER authorize offloading',async()=>{
 const x=await fixture();
 const result=await stageArchiveCopies({source:x.src,key:x.key,archiveId:'synthetic-trip-v1',
   localDir:x.one,oneDriveDir:x.two});
 assert.equal(result.local_restore_verified,true);
 assert.equal(result.sync_folder_restore_verified,true);
 assert.equal(result.remote_cloud_restore_verified,false);
 assert.equal(result.safe_to_delete_source,false);
 assert.deepEqual(await readFile(result.local_copy),await readFile(x.src));
 assert.deepEqual(await readFile(result.synced_folder_copy),await readFile(x.src));
 await restoreEncryptedBackup(result.local_copy,x.key,join(x.root,'test-clean-local'));
 await restoreEncryptedBackup(result.synced_folder_copy,x.key,join(x.root,'test-clean-sync'));
 await assert.rejects(stageArchiveCopies({source:x.src,key:x.key,archiveId:'synthetic-trip-v1',
   localDir:x.one,oneDriveDir:x.two}),/already exists/);
 assert.equal((await readdir(x.one)).some(name=>name.startsWith('.justelle-archive-')),false);
});
test('Wrong key or nested synchronisation folders fail closed without publishing copies',async()=>{
 const x=await fixture();
 await assert.rejects(stageArchiveCopies({source:x.src,key:generateRecoveryKey(),
   archiveId:'wrong-key',localDir:x.one,oneDriveDir:x.two}),/authentication/);
 assert.deepEqual(await readdir(x.one),[]);
 assert.deepEqual(await readdir(x.two),[]);
 await assert.rejects(stageArchiveCopies({source:x.src,key:x.key,
   archiveId:'nested',localDir:x.root,oneDriveDir:x.two}),/independent paths/);
 assert.deepEqual(await readdir(x.two),[]);
});
test('Corrupted staged copy cannot masquerade as independently recoverable archive',async()=>{
 const x=await fixture();
 const result=await stageArchiveCopies({source:x.src,key:x.key,archiveId:'corrupt-test',
   localDir:x.one,oneDriveDir:x.two});
 const bytes=await readFile(result.synced_folder_copy);bytes[bytes.length-21]^=255;
 await writeFile(result.synced_folder_copy,bytes);
 await assert.rejects(restoreEncryptedBackup(result.synced_folder_copy,x.key,
   join(x.root,'corrupt-recovery')),/authentication|Incomplete|checksum/);
 assert.ok(await stat(x.src),'Staging and tampering never delete the source');
});

test('Resolved symlink and junction aliases cannot defeat independent archive folder checks',async()=>{
 const x=await fixture(),alias=join(x.root,'alias');
 // An alias of the OneDrive folder must not also be used as the non-sync copy.
 await symlink(x.two,alias,process.platform==='win32'?'junction':'dir');
 await assert.rejects(stageArchiveCopies({source:x.src,key:x.key,
   archiveId:'alias-conflict',localDir:alias,oneDriveDir:x.two}),/independent paths/);
 assert.deepEqual(await readdir(x.one),[]);
 assert.deepEqual(await readdir(x.two),[]);
});

test('An aliased source directory never receives a supposedly separate archive',async()=>{
 const x=await fixture(),alias=join(x.root,'outside-name');
 await symlink(x.root,alias,process.platform==='win32'?'junction':'dir');
 await assert.rejects(stageArchiveCopies({source:x.src,key:x.key,
   archiveId:'source-alias',localDir:alias,oneDriveDir:x.two}),/independent paths/);
 assert.deepEqual(await readdir(x.two),[]);
 assert.ok(await stat(x.src),'The original ciphertext is never moved or deleted');
});

test('Concurrent staging never replaces another valid sealed generation',async()=>{
 const x=await fixture(),original=await readFile(x.src),options={
   source:x.src,key:x.key,archiveId:'concurrent-v1',localDir:x.one,oneDriveDir:x.two
 };
 const attempts=await Promise.allSettled([
   stageArchiveCopies(options),stageArchiveCopies(options)
 ]);
 assert.equal(attempts.filter(x=>x.status==='fulfilled').length,1,
   'Exactly one independent writer may publish a sealed generation');
 assert.equal(attempts.filter(x=>x.status==='rejected').length,1);
 const [success]=attempts.filter(x=>x.status==='fulfilled').map(x=>x.value);
 assert.equal(success.safe_to_delete_source,false);
 assert.equal(success.remote_cloud_restore_verified,false);
 assert.deepEqual(await readdir(x.one),['justelle-concurrent-v1.jmb']);
 assert.deepEqual(await readdir(x.two),['justelle-concurrent-v1.jmb']);
 assert.deepEqual(await readFile(success.local_copy),original);
 assert.deepEqual(await readFile(success.synced_folder_copy),original);
 assert.deepEqual(await readFile(x.src),original);
 await restoreEncryptedBackup(success.local_copy,x.key,join(x.root,'clean-local'));
 await restoreEncryptedBackup(success.synced_folder_copy,x.key,join(x.root,'clean-sync'));
});
test('An existing dangling destination link is not mistaken for an empty slot',
 {skip:process.platform==='win32'?'File symlinks may require Windows elevation':false},
 async()=>{
  const x=await fixture(),ghost=join(x.one,'justelle-dangling-v1.jmb');
  await symlink(join(x.root,'nonexistent-private-target'),ghost,'file');
  await assert.rejects(stageArchiveCopies({source:x.src,key:x.key,
    archiveId:'dangling-v1',localDir:x.one,oneDriveDir:x.two}),/already exists/);
  assert.deepEqual(await readdir(x.one),['justelle-dangling-v1.jmb']);
  assert.deepEqual(await readdir(x.two),[]);
  assert.ok(await stat(x.src),'The original backup is untouched');
});
