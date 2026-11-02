import test from 'node:test';
import assert from 'node:assert/strict';
import {createOfflineDocumentCache,isConfirmedAccessDenied,isConfirmedOffline,offlineScopeKeys,
  purgeOfflineDocumentCache} from '../web/offline-document-cache.mjs';
import {sha256} from '../web/media.mjs';

const scope={environment:'hosted-fictional',projectId:'justelle-qualification',roomId:'fictional-room',memberUid:'member-one'};
const documentId='123e4567-e89b-12d3-a456-426614174000';
class FakeChannel{
  static channels=new Set();
  constructor(name){this.name=name;this.closed=false;FakeChannel.channels.add(this);}
  postMessage(data){for(const channel of FakeChannel.channels)
    if(channel!==this&&!channel.closed&&channel.name===this.name)channel.onmessage?.({data:structuredClone(data)});}
  close(){this.closed=true;FakeChannel.channels.delete(this);}
}
function fakeStore(){
  const rows=new Map();
  return {
    rows,
    async listOwner(ownerKey){return [...rows.values()].filter(row=>row.ownerKey===ownerKey).map(row=>structuredClone(row));},
    async get(key){return rows.has(key)?structuredClone(rows.get(key)):null;},
    async put(row){rows.set(row.key,structuredClone(row));},
    async remove(key){rows.delete(key);},
    async removeScope(scopeKey){for(const [key,row] of rows)if(row.scopeKey===scopeKey)rows.delete(key);},
    async removeAll(){rows.clear();},
    close(){}
  };
}
function memoryCache(store,overrides={}){
  return createOfflineDocumentCache({scope,indexedDB:{},store,broadcastFactory:FakeChannel,
    isCurrent:()=>true,now:()=>Date.parse('2026-11-02T12:00:00.000Z'),...overrides});
}

test('offline copies are scoped to environment, project, room, and member',()=>{
  const base=offlineScopeKeys(scope);
  assert.notEqual(base.scopeKey,offlineScopeKeys({...scope,memberUid:'member-two'}).scopeKey);
  assert.notEqual(base.scopeKey,offlineScopeKeys({...scope,roomId:'other-room'}).scopeKey);
  assert.notEqual(base.scopeKey,offlineScopeKeys({...scope,projectId:'justelle-production'}).scopeKey);
  assert.notEqual(base.scopeKey,offlineScopeKeys({...scope,environment:'production'}).scopeKey);
  assert.equal(base.ownerKey,offlineScopeKeys({...scope,roomId:'other-room'}).ownerKey);
  assert.equal(base.ownerKey,offlineScopeKeys({...scope,memberUid:'member-two'}).ownerKey);
});

test('only an explicitly selected booking snapshot is saved and marked stale',async()=>{
  const store=fakeStore(),cache=memoryCache(store);
  const snapshot={id:'booking-1',adventureId:'adventure-1',documentId,
    summary:'Synthetic train',kind:'transport',startsOn:'2026-11-12',endsOn:'2026-11-12',
    status:'unverified',sourceTitle:'Rail confirmation',sourceSupplier:'Fictional Rail',
    stopName:'Synthetic station',revision:4,
    savedAt:Date.parse('2026-11-02T12:00:00.000Z'),stale:true};
  const expectedChecksum=await sha256(new TextEncoder().encode(JSON.stringify(snapshot)));
  await cache.saveBooking({id:'booking-1',adventureId:'adventure-1',documentId,
    summary:'Synthetic train',kind:'transport',startsOn:'2026-11-12',endsOn:'2026-11-12',
    sourceTitle:'Rail confirmation',sourceSupplier:'Fictional Rail',
    status:'unverified',stopName:'Synthetic station',revision:4});
  const saved=await cache.getBooking('booking-1');
  assert.deepEqual(saved,{id:'booking-1',adventureId:'adventure-1',documentId,
    summary:'Synthetic train',kind:'transport',startsOn:'2026-11-12',endsOn:'2026-11-12',
    sourceTitle:'Rail confirmation',sourceSupplier:'Fictional Rail',
    status:'unverified',stopName:'Synthetic station',revision:4,
    savedAt:Date.parse('2026-11-02T12:00:00.000Z'),stale:true,sha256:expectedChecksum});
  assert.equal(store.rows.size,1);
  await cache.close();
  assert.equal(store.rows.size,0);
});

test('a changed offline booking snapshot fails its checksum and is removed',async()=>{
  const store=fakeStore(),cache=memoryCache(store);
  await cache.saveBooking({id:'booking-1',adventureId:'adventure-1',summary:'Synthetic',kind:'stay',
    startsOn:'2026-11-12',endsOn:'2026-11-13',status:'confirmed',revision:1});
  const row=[...store.rows.values()][0];row.data.summary='Changed locally';
  await assert.rejects(cache.getBooking('booking-1'),/integrity check/);
  assert.equal(store.rows.size,0);
  await cache.close();
});

test('original confirmation is separately saved, bounded, and checksum verified',async()=>{
  const store=fakeStore(),cache=memoryCache(store),bytes=new Uint8Array([1,2,3,4]);
  const hash=await sha256(bytes);
  await cache.saveDocument({id:documentId,name:'synthetic.pdf',mime:'application/pdf',
    size:bytes.length,sha256:hash,bytes,revision:7});
  const saved=await cache.getDocument(documentId);
  assert.deepEqual([...saved.bytes],[1,2,3,4]);
  assert.equal(saved.stale,true);assert.equal(saved.revision,7);assert.equal(saved.sha256,hash);
  await assert.rejects(cache.saveDocument({id:documentId,name:'synthetic.pdf',mime:'application/pdf',
    size:bytes.length,sha256:'0'.repeat(64),bytes,revision:7}),/integrity check/);
  await assert.rejects(cache.saveDocument({id:documentId,name:'synthetic.pdf',mime:'text/plain',
    size:bytes.length,sha256:hash,bytes,revision:7}),/Invalid protected original/);
  await cache.removeDocument(documentId);assert.equal(await cache.getDocument(documentId),null);
  await cache.close();
});

test('a permission denial never falls back to an offline copy',()=>{
  assert.equal(isConfirmedAccessDenied(Object.assign(Error('denied'),{code:'permission-denied'})),true);
  assert.equal(isConfirmedAccessDenied(Object.assign(Error('denied'),{code:'unauthenticated'})),true);
  assert.equal(isConfirmedAccessDenied(Object.assign(Error('missing'),{code:'storage/object-not-found'})),false);
  assert.equal(isConfirmedOffline(Object.assign(Error('denied'),{code:'permission-denied'}),false),false);
  assert.equal(isConfirmedOffline(Object.assign(Error('denied'),{code:'storage/unauthorized'}),false),false);
  assert.equal(isConfirmedOffline(Object.assign(Error('offline'),{code:'unavailable'}),false),true);
  assert.equal(isConfirmedOffline(Object.assign(Error('offline'),{name:'TypeError'}),false),true);
  assert.equal(isConfirmedOffline(Object.assign(Error('validation'),{code:'invalid-argument'}),false),false);
  assert.equal(isConfirmedOffline(Object.assign(Error('network'),{code:'unavailable'}),true),false);
});

test('a partially failed save removes its exact cache entry',async()=>{
  const store=fakeStore(),put=store.put.bind(store);
  store.put=async row=>{await put(row);throw Error('synthetic transaction failure');};
  const cache=memoryCache(store);
  await assert.rejects(cache.saveBooking({id:'booking-1',adventureId:'adventure-1',summary:'Synthetic',kind:'stay',
    startsOn:'2026-11-12',endsOn:'2026-11-13',status:'confirmed',revision:1}),/synthetic transaction failure/);
  assert.equal(store.rows.size,0);
  await cache.close();
});

test('room changes remove the prior room cache and closed sessions cannot read or write',async()=>{
  const store=fakeStore(),first=memoryCache(store);
  await first.saveBooking({id:'booking-1',adventureId:'adventure-1',summary:'Synthetic first',kind:'stay',
    startsOn:'2026-11-12',endsOn:'2026-11-13',status:'confirmed',revision:1});
  const second=memoryCache(store,{scope:{...scope,roomId:'new-room'}});
  await second.saveBooking({id:'booking-2',adventureId:'adventure-2',summary:'Synthetic second',kind:'stay',
    startsOn:'2026-11-14',endsOn:'2026-11-15',status:'confirmed',revision:2});
  assert.equal(store.rows.size,1);
  await assert.rejects(first.getBooking('booking-1'),/session/);
  await second.close();
  assert.equal(store.rows.size,0);
});

test('changing member accounts clears the previous member copy in the same project',async()=>{
  const store=fakeStore(),first=memoryCache(store);
  await first.saveBooking({id:'booking-1',adventureId:'adventure-1',summary:'Synthetic',kind:'stay',
    startsOn:'2026-11-12',endsOn:'2026-11-13',status:'confirmed',revision:1});
  const second=memoryCache(store,{scope:{...scope,memberUid:'member-two'}});
  await second.activate();
  assert.equal(store.rows.size,0);
  await assert.rejects(first.getBooking('booking-1'),/session/);
  await second.close();
});

test('a changed or signed-out session cannot use the cache',async()=>{
  const store=fakeStore();let current=true;const cache=memoryCache(store,{isCurrent:()=>current});
  current=false;
  await assert.rejects(cache.saveBooking({id:'booking-1',adventureId:'adventure-1',summary:'Synthetic',kind:'stay',
    startsOn:'2026-11-12',endsOn:'2026-11-13',status:'confirmed',revision:1}),/session/);
});

test('sign-out in another tab clears this session and blocks further cache access',async()=>{
  const store=fakeStore(),first=memoryCache(store),second=memoryCache(store);
  await first.saveBooking({id:'booking-1',adventureId:'adventure-1',summary:'Synthetic',kind:'stay',
    startsOn:'2026-11-12',endsOn:'2026-11-13',status:'confirmed',revision:1});
  await second.getBooking('booking-1');
  await first.close();
  await assert.rejects(second.getBooking('booking-1'),/session/);
  await new Promise(resolve=>setImmediate(resolve));
  assert.equal(store.rows.size,0);
  await second.close();
});

test('a save finishing after sign-out is removed instead of repopulating the cache',async()=>{
  const store=fakeStore();let releasePut,startedResolve;
  const started=new Promise(resolve=>{startedResolve=resolve;});
  const gate=new Promise(resolve=>{releasePut=resolve;});
  const put=store.put.bind(store);
  store.put=async row=>{startedResolve();await gate;await put(row);};
  const cache=memoryCache(store);
  const pending=cache.saveBooking({id:'booking-1',adventureId:'adventure-1',summary:'Synthetic',kind:'stay',
    startsOn:'2026-11-12',endsOn:'2026-11-13',status:'confirmed',revision:1});
  await started;
  const closing=cache.close();releasePut();
  await assert.rejects(pending,/session/);await closing;
  assert.equal(store.rows.size,0);
});

test('removing a booking cancels an in-flight save in the same and another tab',async()=>{
  const store=fakeStore(),first=memoryCache(store),second=memoryCache(store);
  let releasePut,startedResolve;
  const started=new Promise(resolve=>{startedResolve=resolve;});
  const gate=new Promise(resolve=>{releasePut=resolve;});
  const put=store.put.bind(store);
  store.put=async row=>{startedResolve();await gate;await put(row);};
  const pending=second.saveBooking({id:'booking-1',adventureId:'adventure-1',summary:'Synthetic',kind:'stay',
    startsOn:'2026-11-12',endsOn:'2026-11-13',status:'confirmed',revision:1});
  await started;
  await first.removeBooking('booking-1');
  releasePut();
  await assert.rejects(pending,/superseded/);
  assert.equal(store.rows.size,0);
  await first.close();await second.close();
});

test('an older failed save cannot erase a newer successful save',async()=>{
  const store=fakeStore(),cache=memoryCache(store);
  let releaseOld,oldStartedResolve;
  const oldStarted=new Promise(resolve=>{oldStartedResolve=resolve;});
  const oldGate=new Promise(resolve=>{releaseOld=resolve;});
  const put=store.put.bind(store);
  store.put=async row=>{
    if(row.data.summary==='Older draft'){oldStartedResolve();await oldGate;throw Error('synthetic old write failure');}
    await put(row);
  };
  const oldSave=cache.saveBooking({id:'booking-1',adventureId:'adventure-1',summary:'Older draft',kind:'stay',
    startsOn:'2026-11-12',endsOn:'2026-11-13',status:'confirmed',revision:1});
  await oldStarted;
  await cache.saveBooking({id:'booking-1',adventureId:'adventure-1',summary:'Newer draft',kind:'stay',
    startsOn:'2026-11-12',endsOn:'2026-11-13',status:'confirmed',revision:2});
  releaseOld();
  await assert.rejects(oldSave,/synthetic old write failure/);
  assert.equal((await cache.getBooking('booking-1')).summary,'Newer draft');
  await cache.close();
});

test('startup purge clears copies left by a crashed or signed-out tab',async()=>{
  const store=fakeStore(),cache=memoryCache(store);
  await cache.saveBooking({id:'booking-1',adventureId:'adventure-1',summary:'Synthetic',kind:'stay',
    startsOn:'2026-11-12',endsOn:'2026-11-13',status:'confirmed',revision:1});
  await purgeOfflineDocumentCache({store});
  assert.equal(store.rows.size,0);
  await cache.close();
});

test('a failed sign-out clear remains reportable instead of becoming a false success',async()=>{
  const store=fakeStore(),cache=memoryCache(store);
  store.removeScope=async()=>{throw Error('synthetic clear failure');};
  await assert.rejects(cache.close(),/synthetic clear failure/);
});
