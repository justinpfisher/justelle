// Provider-neutral encrypted backup. No Firebase, AI SDK or network access.
// Metadata is bounded at 64 MiB; binary originals stream in 256 KiB frames.
import {createCipheriv,createDecipheriv,createHash,randomBytes,hkdfSync} from 'node:crypto';
import {open,mkdir,mkdtemp,rm,link,unlink,stat,writeFile} from 'node:fs/promises';
import {createReadStream} from 'node:fs';
import {join,dirname,basename} from 'node:path';
import {DatabaseSync} from 'node:sqlite';
import {verifyRecords,recordKinds,optionalRecordKinds} from '../web/archive-core.mjs';

const MAGIC=Buffer.from('JUSTELLE-BACKUP-2\n');
const HEADER_BYTES=MAGIC.length+16;
const CHUNK=256*1024,MAX_METADATA=64*1024*1024,MAX_FILE=2*1024*1024*1024;
const FORMAT='justelle-encrypted-memory-v2';
const kinds=r=>[...recordKinds,...optionalRecordKinds.filter(k=>r[k])];
function validateKey(key){if(!(key instanceof Uint8Array)||key.byteLength!==32)throw Error('A separate 32-byte recovery key is required');}
export function generateRecoveryKey(){return randomBytes(32);}
function nonce(header,sequence){const n=Buffer.alloc(12);header.copy(n,0,MAGIC.length,MAGIC.length+4);n.writeBigUInt64BE(BigInt(sequence),4);return n;}
function archiveKey(key,header){return Buffer.from(hkdfSync('sha256',key,header.subarray(MAGIC.length),Buffer.from(FORMAT),32));}
function aad(header,sequence){const index=Buffer.alloc(8);index.writeBigUInt64BE(BigInt(sequence));return Buffer.concat([header,index]);}
async function writeAll(handle,bytes){let offset=0;while(offset<bytes.length){const {bytesWritten}=await handle.write(bytes,offset,bytes.length-offset);if(!bytesWritten)throw Error('Backup write failed');offset+=bytesWritten;}}
async function exact(handle,count,optional=false){const data=Buffer.alloc(count);let offset=0;while(offset<count){const {bytesRead}=await handle.read(data,offset,count-offset,null);if(!bytesRead){if(optional&&offset===0)return null;throw Error('Truncated backup');}offset+=bytesRead;}return data;}
async function newDestination(path){try{await stat(path);throw Error('Destination already exists; choose a new path');}catch(e){if(e.code!=='ENOENT')throw e;}}
function expectedFiles(records){
  const files=new Map();
  for(const a of records.attachments){
    if(!/^[a-f0-9-]{36}$/.test(a.id)||!['image/png','image/jpeg','image/heic','image/heif'].includes(a.mime)||
       !Number.isSafeInteger(a.size)||a.size<1||a.size>MAX_FILE||!/^[a-f0-9]{64}$/.test(a.sha256))throw Error('Invalid original image descriptor');
    files.set(a.id,{mime:a.mime,size:a.size,sha256:a.sha256});
    if(a.preview_path)files.set(a.id+'-preview',{mime:'image/jpeg'});
  }
  return files;
}
function mediaEnd(expected,actual){
  if(actual.size<1||actual.size>MAX_FILE||actual.sha256.length!==64||
     (expected.size!==undefined&&actual.size!==expected.size)||
     (expected.sha256&&actual.sha256!==expected.sha256))throw Error('Original image checksum or size mismatch');
}

// `media` may be an async iterable backed by an authorised provider adapter.
// Each entry supplies {id,mime,stream}; streams must yield byte chunks.
export async function writeEncryptedBackup({records,media,key},destination){
  validateKey(key);const counts=verifyRecords(records),expected=expectedFiles(records);
  const metadata=Buffer.from(JSON.stringify({format:FORMAT,created_at:new Date().toISOString(),records}));
  if(metadata.length>MAX_METADATA)throw Error('Metadata exceeds this backup version’s 64 MiB limit');
  await newDestination(destination);await mkdir(dirname(destination),{recursive:true});
  const staging=await mkdtemp(join(dirname(destination),'.'+basename(destination)+'-'));
  let handle;const seen=new Set();let bytes=0,frames=0;
  try{
    const temp=join(staging,'encrypted');handle=await open(temp,'wx',0o600);
    const header=Buffer.concat([MAGIC,randomBytes(16)]),derived=archiveKey(key,header);await writeAll(handle,header);
    async function frame(type,body=Buffer.alloc(0)){
      if(body.length>CHUNK)throw Error('Frame too large');
      const cipher=createCipheriv('aes-256-gcm',derived,nonce(header,frames));cipher.setAAD(aad(header,frames));
      const ciphertext=Buffer.concat([cipher.update(Buffer.concat([Buffer.from([type]),body])),cipher.final(),cipher.getAuthTag()]);
      const length=Buffer.alloc(4);length.writeUInt32BE(ciphertext.length);
      await writeAll(handle,length);await writeAll(handle,ciphertext);frames++;
    }
    for(let i=0;i<metadata.length;i+=CHUNK)await frame(1,metadata.subarray(i,i+CHUNK));
    await frame(2);
    for await(const f of media){
      const descriptor=expected.get(f.id);
      if(!descriptor||descriptor.mime!==f.mime||seen.has(f.id))throw Error('Unreferenced or duplicate image');
      seen.add(f.id);await frame(3,Buffer.from(JSON.stringify({id:f.id,mime:f.mime})));
      const hash=createHash('sha256');let size=0;
      for await(const input of f.stream){
        if(!(input instanceof Uint8Array))throw Error('Image stream must contain bytes');
        const chunk=Buffer.from(input.buffer,input.byteOffset,input.byteLength);
        size+=chunk.length;if(size>MAX_FILE)throw Error('Image too large for this backup format');
        hash.update(chunk);
        for(let i=0;i<chunk.length;i+=CHUNK)await frame(4,chunk.subarray(i,i+CHUNK));
      }
      const actual={size,sha256:hash.digest('hex')};mediaEnd(descriptor,actual);bytes+=size;
      await frame(5,Buffer.from(JSON.stringify(actual)));
    }
    if(seen.size!==expected.size)throw Error('Missing original or preview image');
    await frame(6,Buffer.from(JSON.stringify({files:seen.size,bytes,metadata_sha256:createHash('sha256').update(metadata).digest('hex')})));
    await handle.sync();await handle.close();handle=null;
    // Atomic no-clobber publication; a racing writer cannot replace a backup.
    await link(temp,destination);await unlink(temp);
    return {format:FORMAT,records:counts,files:seen.size,bytes,frames};
  }finally{await handle?.close();await rm(staging,{recursive:true,force:true});}
}

export async function writeDirectoryBackup(source,key,destination){
  const records=JSON.parse(await import('node:fs/promises').then(fs=>fs.readFile(join(source,'records.json'),'utf8')));
  const expected=expectedFiles(records);
  async function* media(){for(const [id,d] of expected)yield {id,mime:d.mime,stream:createReadStream(join(source,'media',id),{highWaterMark:CHUNK})};}
  return writeEncryptedBackup({records,media:media(),key},destination);
}
function writeDatabase(records,path,manifest,media){
  const db=new DatabaseSync(path);
  try{
    db.exec('CREATE TABLE records(kind TEXT,id TEXT,author_id TEXT,created_at TEXT,data_json TEXT,PRIMARY KEY(kind,id)); CREATE TABLE approvals(decision_id TEXT,person_id TEXT,at TEXT,PRIMARY KEY(decision_id,person_id)); CREATE TABLE media(id TEXT PRIMARY KEY,mime TEXT,sha256 TEXT,size INTEGER,filename TEXT); CREATE TABLE manifest(data_json TEXT); BEGIN TRANSACTION;');
    const insert=db.prepare('INSERT INTO records VALUES(?,?,?,?,?)');
    for(const kind of kinds(records))for(const row of records[kind]){
      insert.run(kind,row.id,row.author_id||null,row.created_at||null,JSON.stringify(row));
      if(kind==='decisions')for(const vote of row.approvals||[])db.prepare('INSERT INTO approvals VALUES(?,?,?)').run(row.id,vote.person_id,vote.at||null);
    }
    for(const f of media)db.prepare('INSERT INTO media VALUES(?,?,?,?,?)').run(f.id,f.mime,f.sha256,f.size,'media/'+f.id);
    db.prepare('INSERT INTO manifest VALUES(?)').run(JSON.stringify(manifest));db.exec('COMMIT');
  }finally{db.close();}
}

export async function restoreEncryptedBackup(source,key,destination){
  validateKey(key);await newDestination(destination);await mkdir(dirname(destination),{recursive:true});
  const staging=await mkdtemp(join(dirname(destination),'.'+basename(destination)+'-'));
  let handle,current,outputCreated=false;
  try{
    await mkdir(join(staging,'media'),{mode:0o700});handle=await open(source,'r');
    const header=await exact(handle,HEADER_BYTES);
    if(!header.subarray(0,MAGIC.length).equals(MAGIC))throw Error('Unrecognised backup format');
    const derived=archiveKey(key,header);
    let frames=0,metadataParts=[],metadataBytes=0,metadata,records,counts,expected,finished=false,bytes=0;
    const seen=new Set(),media=[];
    while(true){
      const length=await exact(handle,4,true);if(!length)break;
      if(finished)throw Error('Trailing data after backup completion');
      const size=length.readUInt32BE();if(size<17||size>CHUNK+17)throw Error('Invalid encrypted frame size');
      const ciphertext=await exact(handle,size);
      const decipher=createDecipheriv('aes-256-gcm',derived,nonce(header,frames));decipher.setAAD(aad(header,frames));decipher.setAuthTag(ciphertext.subarray(-16));
      let plain;try{plain=Buffer.concat([decipher.update(ciphertext.subarray(0,-16)),decipher.final()]);}catch{throw Error('Backup authentication failed: incorrect key or damaged/reordered data');}frames++;
      const type=plain[0],body=plain.subarray(1);
      if(type===1&&!metadata&&!current){metadataBytes+=body.length;if(metadataBytes>MAX_METADATA)throw Error('Backup metadata too large');metadataParts.push(body);}
      else if(type===2&&!metadata&&!current&&body.length===0){
        const raw=Buffer.concat(metadataParts);metadataParts=[];metadata=JSON.parse(raw);
        if(metadata.format!==FORMAT)throw Error('Invalid memory format');records=metadata.records;counts=verifyRecords(records);expected=expectedFiles(records);
        metadata.checksum=createHash('sha256').update(raw).digest('hex');
      }else if(type===3&&metadata&&!current){
        const f=JSON.parse(body);const descriptor=expected.get(f.id);
        if(!descriptor||descriptor.mime!==f.mime||seen.has(f.id))throw Error('Unreferenced or duplicate image');
        seen.add(f.id);current={...f,descriptor,size:0,hash:createHash('sha256'),file:await open(join(staging,'media',f.id),'wx',0o600)};
      }else if(type===4&&current){
        current.size+=body.length;if(current.size>MAX_FILE)throw Error('Image too large');current.hash.update(body);await writeAll(current.file,body);
      }else if(type===5&&current){
        const actual={size:current.size,sha256:current.hash.digest('hex')},end=JSON.parse(body);
        mediaEnd(current.descriptor,actual);
        if(end.size!==actual.size||end.sha256!==actual.sha256)throw Error('Image checksum mismatch');
        await current.file.sync();await current.file.close();media.push({id:current.id,mime:current.mime,...actual});bytes+=actual.size;current=null;
      }else if(type===6&&metadata&&!current){
        const end=JSON.parse(body);
        if(seen.size!==expected.size||end.files!==seen.size||end.bytes!==bytes||end.metadata_sha256!==metadata.checksum)throw Error('Incomplete backup');finished=true;
      }else throw Error('Invalid backup frame order');
    }
    if(!finished||current)throw Error('Incomplete backup: missing authenticated completion');
    await handle.close();handle=null;
    await writeFile(join(staging,'records.json'),JSON.stringify(records,null,2),{mode:0o600});
    writeDatabase(records,join(staging,'memory.sqlite'),metadata,media);
    // Reserve the destination exclusively only AFTER complete authentication.
    // The staging directory remains private on failure; never overwrite recovery.
    await mkdir(destination,{mode:0o700});outputCreated=true;
    const {rename}=await import('node:fs/promises');
    for(const name of ['media','records.json','memory.sqlite'])await rename(join(staging,name),join(destination,name));
    return {format:FORMAT,records:counts,files:seen.size,bytes,frames};
  }catch(e){if(outputCreated)await rm(destination,{recursive:true,force:true});throw e;}
  finally{await current?.file.close();await handle?.close();await rm(staging,{recursive:true,force:true});}
}
