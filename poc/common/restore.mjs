// Provider-agnostic, offline restoration into an ordinary SQLite database and media files.
// The bundle is already sensitive once real data exists; this PoC only uses fictional inputs.
import { DatabaseSync } from 'node:sqlite';
import { createHash } from 'node:crypto';
import {mkdir, writeFile} from 'node:fs/promises';
import {join} from 'node:path';
export async function restoreArchive(bundle,folder) {
  if (bundle?.format!=='justelle-poc-v1' || !Array.isArray(bundle.messages) || !Array.isArray(bundle.decisions) || !Array.isArray(bundle.approvals) || !Array.isArray(bundle.files)) throw Error('Unsupported or incomplete export');
  await mkdir(folder,{recursive:true}); await mkdir(join(folder,'media'),{recursive:true});
  const db=new DatabaseSync(join(folder,'memory.sqlite'));
  db.exec(`PRAGMA foreign_keys=ON;
   CREATE TABLE IF NOT EXISTS messages (id TEXT PRIMARY KEY, room TEXT, author_id TEXT, body TEXT, created_at TEXT);
   CREATE TABLE IF NOT EXISTS decisions (id TEXT PRIMARY KEY, room TEXT, author_id TEXT, body TEXT, status TEXT, created_at TEXT);
   CREATE TABLE IF NOT EXISTS approvals (decision_id TEXT, person_id TEXT, created_at TEXT, PRIMARY KEY(decision_id,person_id), FOREIGN KEY(decision_id) REFERENCES decisions(id));
   CREATE TABLE IF NOT EXISTS media (id TEXT PRIMARY KEY, room TEXT, author_id TEXT, mime TEXT, sha256 TEXT, created_at TEXT, filename TEXT);`);
  const sqlRows={messages:['id','room','author_id','body','created_at'],decisions:['id','room','author_id','body','status','created_at'],approvals:['decision_id','person_id','created_at']};
  db.exec('BEGIN TRANSACTION');
  try {
    for(const [table,cols] of Object.entries(sqlRows)) {
      const statement=db.prepare(`INSERT INTO ${table} (${cols.join(',')}) VALUES (${cols.map(()=>'?').join(',')})`);
      for(const row of bundle[table]) statement.run(...cols.map(c=>row[c]));
    }
    for(const f of bundle.files) {
      if (!/^[a-f0-9-]{36}$/.test(f.id) || !['image/png','image/jpeg'].includes(f.mime) || !/^[a-f0-9]{64}$/.test(f.sha256) || !/^[a-zA-Z0-9+/]*={0,2}$/.test(f.bytes)) throw Error('Invalid media manifest');
      const data=Buffer.from(f.bytes,'base64');
      if (createHash('sha256').update(data).digest('hex') !== f.sha256) throw Error('File checksum mismatch');
      const filename=f.id+(f.mime==='image/png'?'.png':'.jpg');
      await writeFile(join(folder,'media',filename),data,{flag:'wx'});
      db.prepare('INSERT INTO media(id,room,author_id,mime,sha256,created_at,filename) VALUES(?,?,?,?,?,?,?)').run(f.id,f.room,f.author_id,f.mime,f.sha256,f.created_at,filename);
    }
    db.exec('COMMIT');
  } catch(e) { db.exec('ROLLBACK'); db.close(); throw e; }
  const summary={messages:db.prepare('SELECT COUNT(*) n FROM messages').get().n,decisions:db.prepare('SELECT COUNT(*) n FROM decisions').get().n,locked:db.prepare("SELECT COUNT(*) n FROM decisions WHERE status='locked'").get().n,files:db.prepare('SELECT COUNT(*) n FROM media').get().n};
  db.close();return summary;
}
if(process.argv[1] && import.meta.url===new URL(`file://${process.argv[1]}`).href) {
 const {readFile}=await import('node:fs/promises');
 const bundle=JSON.parse(await readFile(process.argv[2],'utf8'));
 console.log(await restoreArchive(bundle,process.argv[3]));
}
