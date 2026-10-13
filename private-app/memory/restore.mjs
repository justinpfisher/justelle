// Restore a fictional Justelle archive without Firebase or an AI provider.
// Checksums and all relationships are checked before any output is created.
import {DatabaseSync} from 'node:sqlite';
import {readFile,mkdir,mkdtemp,writeFile,rm,rename,stat} from 'node:fs/promises';
import {join,dirname,basename} from 'node:path';
import {verifyArchive,recordKinds,optionalRecordKinds} from '../web/archive-core.mjs';

export async function restoreArchive(bundle,destination) {
  const summary=await verifyArchive(bundle);
  try {await stat(destination);throw Error('Restore destination already exists; choose a new folder');}
  catch(e){if(e.code!=='ENOENT')throw e;}
  await mkdir(dirname(destination),{recursive:true});
  const temp=await mkdtemp(join(dirname(destination),'.'+basename(destination)+'-'));
  let db;
  try {
    await mkdir(join(temp,'media'));
    db=new DatabaseSync(join(temp,'memory.sqlite'));
    db.exec('PRAGMA foreign_keys=ON; CREATE TABLE records(kind TEXT,id TEXT,author_id TEXT,created_at TEXT,data_json TEXT,PRIMARY KEY(kind,id)); CREATE TABLE approvals(decision_id TEXT,person_id TEXT,at TEXT,PRIMARY KEY(decision_id,person_id)); CREATE TABLE media(id TEXT PRIMARY KEY,attachment_id TEXT,variant TEXT,mime TEXT,sha256 TEXT,filename TEXT); CREATE TABLE manifest(format TEXT,created_at TEXT,records_sha256 TEXT);');
    db.exec('BEGIN TRANSACTION');
    const insertRecord=db.prepare('INSERT INTO records(kind,id,author_id,created_at,data_json) VALUES(?,?,?,?,?)');
    const insertApproval=db.prepare('INSERT INTO approvals(decision_id,person_id,at) VALUES(?,?,?)');
    for(const kind of [...recordKinds,...optionalRecordKinds.filter(k=>bundle.records[k])]) {
      for(const row of bundle.records[kind]) {
        insertRecord.run(kind,row.id,row.author_id||null,row.created_at||null,JSON.stringify(row));
        if(kind==='decisions') for(const vote of row.approvals||[]) insertApproval.run(row.id,vote.person_id,vote.at||null);
      }
    }
    for(const file of bundle.media) {
      const ext=({'image/jpeg':'.jpg','image/png':'.png','image/heic':'.heic','image/heif':'.heif'})[file.mime];
      const filename=file.id+ext;
      const preview=file.id.endsWith('-preview');
      const attachmentId=preview?file.id.slice(0,-8):file.id;
      await writeFile(join(temp,'media',filename),Buffer.from(file.bytes,'base64'),{flag:'wx'});
      db.prepare('INSERT INTO media(id,attachment_id,variant,mime,sha256,filename) VALUES(?,?,?,?,?,?)').run(file.id,attachmentId,preview?'preview':'original',file.mime,file.sha256,filename);
    }
    db.prepare('INSERT INTO manifest(format,created_at,records_sha256) VALUES(?,?,?)').run(bundle.format,bundle.created_at,bundle.records_sha256);
    db.exec('COMMIT');db.close();db=null;
    await rename(temp,destination);
    return summary;
  } catch(e) {
    if(db){try{db.exec('ROLLBACK');}catch{}db.close();}
    await rm(temp,{recursive:true,force:true});
    throw e;
  }
}
if(process.argv[1] && import.meta.url===new URL('file://'+process.argv[1]).href) {
  if(!process.argv[2]||!process.argv[3]) throw Error('Usage: node memory/restore.mjs <fictional-export.json> <new-output-dir>');
  console.log('Verified offline restore:',await restoreArchive(JSON.parse(await readFile(process.argv[2],'utf8')),process.argv[3]));
}
