import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import vm from 'node:vm';

const origin='https://justelle.example';
const workerSource=(await readFile(new URL('../web/offline-shell-worker.js',import.meta.url),'utf8'))
  .replace('__CACHE_VERSION__','test');
class FakeResponse{
  constructor(body,status=200){this.body=body;this.status=status;this.ok=status>=200&&status<300;this.type='basic';}
  clone(){return new FakeResponse(this.body,this.status);}
  async text(){return this.body;}
}
function createHarness({network=true}={}){
  const listeners=new Map(),stored=new Map(),fetches=[];
  const self={location:{origin},clients:{claim:async()=>{}},skipWaiting:async()=>{},
    addEventListener:(name,handler)=>listeners.set(name,handler)};
  const caches={
    async open(name){return {async put(key,value){stored.set(name+'|'+(typeof key==='string'?key:key.url),value.clone());},
      async match(key){return stored.get(name+'|'+(typeof key==='string'?key:key.url))?.clone()||null;}};},
    async keys(){return [...new Set([...stored.keys()].map(key=>key.split('|')[0]))];},
    async delete(name){for(const key of [...stored.keys()])if(key.startsWith(name+'|'))stored.delete(key);return true;}
  };
  const fetch=async input=>{
    const url=typeof input==='string'?new URL(input,origin):new URL(input.url);
    fetches.push(url.pathname+url.search);
    if(!network)throw TypeError('offline');
    if(url.pathname==='/')return new FakeResponse('<script src="/main.mjs"></script><script src="/api/private.js"></script><link href="/styles.css"><script src="https://other.example/app.js"></script>');
    return new FakeResponse('static');
  };
  vm.runInNewContext(workerSource,{self,caches,fetch,URL,Set,Response:FakeResponse});
  return {listeners,stored,fetches,setNetwork(value){network=value;}};
}
async function fireInstall(harness){
  let pending;harness.listeners.get('install')({waitUntil(value){pending=value;}});await pending;
}

test('offline app-shell install caches only same-origin static shell assets, never API paths',async()=>{
  const h=createHarness();await fireInstall(h);
  assert.ok(h.stored.has('justelle-shell-test|/'));
  assert.ok(h.stored.has('justelle-shell-test|/main.mjs'));
  assert.ok(h.stored.has('justelle-shell-test|/styles.css'));
  assert.equal(h.fetches.some(path=>path.startsWith('/api/')),false);
  assert.equal(h.fetches.some(path=>path.includes('other.example')),false);
});

test('offline navigation falls back to the cached static shell and API requests bypass cache',async()=>{
  const h=createHarness();await fireInstall(h);h.setNetwork(false);
  let responsePromise;
  h.listeners.get('fetch')({request:{method:'GET',mode:'navigate',url:origin+'/'},
    respondWith(value){responsePromise=value;}});
  const response=await responsePromise;
  assert.equal(response.status,200);
  assert.match(await response.text(),/main\.mjs/);
  let intercepted=false;
  h.listeners.get('fetch')({request:{method:'GET',mode:'cors',destination:'',url:origin+'/api/private'},
    respondWith(){intercepted=true;}});
  assert.equal(intercepted,false,'same-origin private API responses are never intercepted or cached');
});
