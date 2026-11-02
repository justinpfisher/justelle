import {sha256} from './media.mjs';

const MAX_DOCUMENT_BYTES=12*1024*1024;
const DOCUMENT_MIMES=new Set(['application/pdf','image/png','image/jpeg','image/heic','image/heif']);
const ID=/^[A-Za-z0-9][A-Za-z0-9_.:-]{0,127}$/;
const UUID=/^[a-f0-9-]{36}$/;
const DB_NAME='justelle-private-offline-v1';
const STORE_NAME='items';

const safeScopePart=value=>{
  if(typeof value!=='string'||!value||value.length>180||/[\u0000-\u001f]/.test(value))
    throw Error('Invalid offline cache scope');
  return value;
};
export function offlineScopeKeys(scope){
  const parts=[scope?.environment,scope?.projectId,scope?.roomId,scope?.memberUid].map(safeScopePart);
  const ownerKey=parts.slice(0,2).map(encodeURIComponent).join('|');
  const scopeKey=parts.map(encodeURIComponent).join('|');
  return {ownerKey,scopeKey};
}

function indexedDbStore(indexedDB){
  let dbPromise;
  const open=()=>dbPromise||=(new Promise((resolve,reject)=>{
    if(!indexedDB)throw Error('Offline copies are unavailable in this browser');
    const request=indexedDB.open(DB_NAME,1);
    request.onupgradeneeded=()=>{
      const db=request.result;
      if(!db.objectStoreNames.contains(STORE_NAME)){
        const store=db.createObjectStore(STORE_NAME,{keyPath:'key'});
        store.createIndex('scopeKey','scopeKey',{unique:false});
        store.createIndex('ownerKey','ownerKey',{unique:false});
      }
    };
    request.onsuccess=()=>resolve(request.result);
    request.onerror=()=>reject(request.error||Error('Offline copies are unavailable in this browser'));
    request.onblocked=()=>reject(Error('Offline copies are busy in another Justelle tab'));
  }));
  const requestResult=request=>new Promise((resolve,reject)=>{
    request.onsuccess=()=>resolve(request.result);
    request.onerror=()=>reject(request.error||Error('Offline copy storage failed'));
  });
  const done=tx=>new Promise((resolve,reject)=>{
    tx.oncomplete=()=>resolve();
    tx.onabort=tx.onerror=()=>reject(tx.error||Error('Offline copy storage failed'));
  });
  return {
    async listOwner(ownerKey){
      const db=await open(),tx=db.transaction(STORE_NAME,'readonly'),finished=done(tx);
      const rows=await requestResult(tx.objectStore(STORE_NAME).index('ownerKey').getAll(ownerKey));
      await finished;return rows;
    },
    async get(key){
      const db=await open(),tx=db.transaction(STORE_NAME,'readonly'),finished=done(tx);
      const row=await requestResult(tx.objectStore(STORE_NAME).get(key));
      await finished;return row||null;
    },
    async put(row){
      const db=await open(),tx=db.transaction(STORE_NAME,'readwrite'),finished=done(tx);
      tx.objectStore(STORE_NAME).put(row);await finished;
    },
    async remove(key){
      const db=await open(),tx=db.transaction(STORE_NAME,'readwrite'),finished=done(tx);
      tx.objectStore(STORE_NAME).delete(key);await finished;
    },
    async removeScope(scopeKey){
      const db=await open(),tx=db.transaction(STORE_NAME,'readwrite'),finished=done(tx);
      const index=tx.objectStore(STORE_NAME).index('scopeKey');
      const request=index.openKeyCursor(IDBKeyRange.only(scopeKey));
      request.onsuccess=()=>{const cursor=request.result;if(cursor){tx.objectStore(STORE_NAME).delete(cursor.primaryKey);cursor.continue();}};
      await finished;
    },
    async removeAll(){
      const db=await open(),tx=db.transaction(STORE_NAME,'readwrite'),finished=done(tx);
      tx.objectStore(STORE_NAME).clear();await finished;
    },
    close(){dbPromise?.then(db=>db.close()).catch(()=>{});dbPromise=null;}
  };
}

export async function purgeOfflineDocumentCache({indexedDB=globalThis.indexedDB,store=null}={}){
  if(!store&&!indexedDB)return;
  const backend=store||indexedDbStore(indexedDB);
  try{await backend.removeAll();}finally{backend.close?.();}
}

const clone=value=>typeof structuredClone==='function'?structuredClone(value):JSON.parse(JSON.stringify(value));

// The cache is only created after normal authenticated membership checks. It
// never authenticates a user or grants cold-start access; disposal clears this
// member/room scope and invalidates in-flight writes.
export function createOfflineDocumentCache({scope,indexedDB=globalThis.indexedDB,
  store=null,isCurrent=()=>true,now=()=>Date.now(),broadcastFactory=globalThis.BroadcastChannel}){
  const {ownerKey,scopeKey}=offlineScopeKeys(scope);
  const backend=store||indexedDbStore(indexedDB);
  let active=true,readyPromise=null,closePromise=null;
  const recordVersions=new Map();
  const key=(kind,id)=>scopeKey+'|'+kind+'|'+encodeURIComponent(id);
  const versionOf=recordKey=>recordVersions.get(recordKey)?.version||0;
  const nextVersion=(recordKey,operation)=>{
    const version=versionOf(recordKey)+1;recordVersions.set(recordKey,{version,operation});return version;
  };
  const startWrite=(kind,id)=>{const recordKey=key(kind,id);return {recordKey,version:nextVersion(recordKey,'write')};};
  const clearRecord=async(kind,id)=>{
    const recordKey=key(kind,id),version=nextVersion(recordKey,'remove');
    try{channel?.postMessage({type:'record-cleared',scopeKey,key:recordKey});}catch{}
    await ready();assertCurrent();
    if(versionOf(recordKey)===version)await backend.remove(recordKey);
  };
  const assertCurrent=()=>{if(!active||!isCurrent())throw Error('Offline copies are unavailable outside the signed-in session');};
  const ready=()=>readyPromise||=(async()=>{
    assertCurrent();
    const prior=await backend.listOwner(ownerKey);
    assertCurrent();
    const oldScopes=new Set(prior.filter(item=>item.scopeKey!==scopeKey).map(item=>item.scopeKey));
    for(const oldScopeKey of oldScopes)try{channel?.postMessage({type:'scope-cleared',scopeKey:oldScopeKey});}catch{}
    for(const item of prior)if(item.scopeKey!==scopeKey)await backend.remove(item.key);
    assertCurrent();
  })();
  let channel=null;
  try{
    if(broadcastFactory){
      channel=new broadcastFactory('justelle-private-offline-v1');
      channel.onmessage=event=>{
        if(event.data?.type==='record-cleared'&&event.data.scopeKey===scopeKey&&
          typeof event.data.key==='string'&&event.data.key.startsWith(scopeKey+'|')){
          nextVersion(event.data.key,'remove');void backend.remove(event.data.key).catch(()=>{});
        }
        if(event.data?.type==='scope-cleared'&&event.data.scopeKey===scopeKey){
          active=false;
          void backend.removeScope(scopeKey).catch(()=>{});
        }
      };
    }
  }catch{channel=null;}

  async function read(kind,id){
    assertCurrent();await ready();assertCurrent();
    const row=await backend.get(key(kind,id));assertCurrent();
    return row&&row.scopeKey===scopeKey?row:null;
  }
  async function write(row,token){
    assertCurrent();await ready();assertCurrent();
    const stored={...row,key:key(row.kind,row.recordId),scopeKey,ownerKey};
    if(stored.key!==token.recordKey||versionOf(token.recordKey)!==token.version)
      throw Error('Offline copy save was superseded');
    try{await backend.put(stored);}
    catch(error){
      // IndexedDB transactions are atomic, but remove the exact key as a
      // defense for alternate/test stores that report failure after a write.
      // Do not let an older failed save erase a newer successful save.
      const latest=recordVersions.get(token.recordKey);
      if(!active||!isCurrent())try{await backend.removeScope(scopeKey);}catch{}
      else if(latest?.version===token.version||latest?.operation==='remove')
        try{await backend.remove(stored.key);}catch{}
      throw error;
    }
    if(!active||!isCurrent()){
      await backend.removeScope(scopeKey);
      assertCurrent();
    }
    if(versionOf(token.recordKey)!==token.version){
      if(recordVersions.get(token.recordKey)?.operation==='remove')await backend.remove(token.recordKey);
      throw Error('Offline copy save was superseded');
    }
  }
  return {
    activate(){return ready();},
    async saveBooking({id:bookingId,adventureId,documentId=null,summary,kind,startsOn,endsOn,status,
      sourceTitle=null,sourceSupplier=null,stopName=null,revision}){
      if(!ID.test(bookingId||'')||!ID.test(adventureId||'')||!Number.isSafeInteger(revision)||revision<0||
        (documentId!==null&&!UUID.test(documentId||''))||
        typeof summary!=='string'||!summary.trim()||summary.length>180||
        !['stay','flight','transport','activity'].includes(kind)||!/^\d{4}-\d{2}-\d{2}$/.test(startsOn||'')||
        !/^\d{4}-\d{2}-\d{2}$/.test(endsOn||'')||!['unverified','confirmed','cancelled','voided'].includes(status)||
        (sourceTitle!==null&&(typeof sourceTitle!=='string'||sourceTitle.length>180))||
        (sourceSupplier!==null&&(typeof sourceSupplier!=='string'||sourceSupplier.length>180))||
        (stopName!==null&&(typeof stopName!=='string'||stopName.length>180)))
        throw Error('Invalid booking snapshot');
      const token=startWrite('booking',bookingId);
      const savedAt=now();
      const data={id:bookingId,adventureId,documentId,summary:summary.trim(),kind,startsOn,endsOn,status,
        sourceTitle:sourceTitle?.trim()||null,sourceSupplier:sourceSupplier?.trim()||null,stopName,
        revision,savedAt,stale:true};
      const checksum=await sha256(new TextEncoder().encode(JSON.stringify(data)));
      assertCurrent();
      await write({kind:'booking',recordId:bookingId,adventureId,
        data:{...data,sha256:checksum}},token);
      return {savedAt,revision,stale:true,sha256:checksum};
    },
    async getBooking(bookingId){
      if(!ID.test(bookingId||''))return null;
      const row=await read('booking',bookingId);if(!row)return null;
      const data=clone(row.data),{sha256:expectedHash,...content}=data;
      if(!/^[a-f0-9]{64}$/.test(expectedHash||'')||await sha256(new TextEncoder().encode(JSON.stringify(content)))!==expectedHash){
        assertCurrent();await backend.remove(key('booking',bookingId));
        throw Error('Saved booking snapshot failed its integrity check');
      }
      assertCurrent();return data;
    },
    async saveDocument({id:documentId,name,mime,size,sha256:expectedHash,bytes,revision}){
      if(!UUID.test(documentId||'')||typeof name!=='string'||!name.trim()||name.length>180||
        !DOCUMENT_MIMES.has(mime)||!Number.isSafeInteger(size)||size<1||size>MAX_DOCUMENT_BYTES||
        !(bytes instanceof Uint8Array)||bytes.byteLength!==size||!/^[a-f0-9]{64}$/.test(expectedHash||'')||
        !Number.isSafeInteger(revision)||revision<0)
        throw Error('Invalid protected original for offline saving');
      const token=startWrite('document',documentId);
      const digest=await sha256(bytes);assertCurrent();
      if(digest!==expectedHash)throw Error('Original document failed its integrity check');
      const savedAt=now();
      await write({kind:'document',recordId:documentId,data:{id:documentId,name:name.trim(),mime,size,
        sha256:digest,bytes:bytes.slice(),revision,savedAt,stale:true}},token);
      return {savedAt,revision,stale:true,sha256:digest};
    },
    async getDocument(documentId){
      if(!UUID.test(documentId||''))return null;
      const row=await read('document',documentId);if(!row)return null;
      const data=clone(row.data);
      if(!(data.bytes instanceof Uint8Array)||data.bytes.byteLength!==data.size||await sha256(data.bytes)!==data.sha256){
        assertCurrent();await backend.remove(key('document',documentId));
        throw Error('Saved original failed its integrity check');
      }
      assertCurrent();return data;
    },
    async removeBooking(bookingId){
      if(!ID.test(bookingId||''))return;
      assertCurrent();await clearRecord('booking',bookingId);
    },
    async removeDocument(documentId){
      if(!UUID.test(documentId||''))return;
      assertCurrent();await clearRecord('document',documentId);
    },
    close(){
      if(closePromise)return closePromise;
      active=false;
      try{channel?.postMessage({type:'scope-cleared',scopeKey});}catch{}
      channel?.close?.();
      closePromise=backend.removeScope(scopeKey).finally(()=>backend.close?.());
      return closePromise;
    }
  };
}

export function isConfirmedOffline(error,online=globalThis.navigator?.onLine!==false){
  const code=String(error?.code||'').toLowerCase();
  if(['permission-denied','unauthenticated','storage/unauthorized','storage/object-not-found'].includes(code))return false;
  return online===false&&(error?.name==='TypeError'||['unavailable','firestore/unavailable',
    'network-error','auth/network-request-failed'].includes(code));
}

export function isConfirmedAccessDenied(error){
  const code=String(error?.code||'').toLowerCase();
  return ['permission-denied','unauthenticated','firestore/permission-denied',
    'storage/unauthorized','auth/unauthorized'].includes(code);
}
