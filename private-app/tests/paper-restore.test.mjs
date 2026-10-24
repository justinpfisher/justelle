import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,readFile,rm,stat} from 'node:fs/promises';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {createHash} from 'node:crypto';
import {Readable} from 'node:stream';
import {generateRecoveryKey,writeEncryptedBackup} from '../memory/encrypted-backup.mjs';
import {restoreFromPaper} from '../memory/backup-cli.mjs';

test('a printed 32-byte recovery key independently restores the exact original without a key file',async()=>{
  const dir=await mkdtemp(join(tmpdir(),'justelle-paper-restore-'));
  const key=generateRecoveryKey(),original=await readFile(new URL('./fictional-landscape.png',import.meta.url));
  const attachmentId='00000000-0000-4000-8000-000000000001';
  const records={
    persons:[{id:'person-a',label:'Fictional A'},{id:'person-b',label:'Fictional B'}],
    conversations:[],messages:[],decisions:[],adventures:[],
    attachments:[{id:attachmentId,name:'synthetic.png',mime:'image/png',size:original.length,
      sha256:createHash('sha256').update(original).digest('hex'),author_id:'person-a',preview_path:null}]
  };
  try{
    const archive=join(dir,'fictional.jmb'),restored=join(dir,'restore');
    await writeEncryptedBackup({records,media:[{id:attachmentId,mime:'image/png',
      stream:Readable.from([original])}],key},archive);
    const entered=Buffer.from(key);
    const result=await restoreFromPaper(archive,restored,{readKey:async()=>entered});
    assert.equal(result.files,1);
    assert.deepEqual(await readFile(join(restored,'media',attachmentId)),original);
    assert.deepEqual(JSON.parse(await readFile(join(restored,'records.json'),'utf8')),records);
    assert.deepEqual(entered,Buffer.alloc(32), 'the temporary typed key is zeroed after use');
    const wrong=Buffer.alloc(32,9),failureDestination=join(dir,'wrong');
    await assert.rejects(restoreFromPaper(archive,failureDestination,{readKey:async()=>wrong}),/authentication/);
    assert.deepEqual(wrong,Buffer.alloc(32));
    await assert.rejects(stat(failureDestination),{code:'ENOENT'});
  }finally{key.fill(0);await rm(dir,{recursive:true,force:true});}
});
