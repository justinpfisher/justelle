import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,mkdir,readFile,writeFile,copyFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import vm from 'node:vm';

const origin='https://justelle.example';
const workerTemplate=await readFile(new URL('../web/offline-shell-worker.js',import.meta.url),'utf8');
const workerSource=workerTemplate.replace('__CACHE_VERSION__','test');
const run=promisify(execFile);
const shellHtml='<script src="/assets/app.js"></script><script src="/api/private.js"></script><link href="/styles.css"><script src="https://other.example/app.js"></script>';
class FakeResponse{
  constructor(body,status=200,type='basic'){
    this.body=body;this.status=typeof status==='number'?status:status.status;
    this.ok=this.status>=200&&this.status<300;this.type=type;
  }
  clone(){return new FakeResponse(this.body,this.status,this.type);}
  async text(){return this.body;}
}
function createHarness({network=true,stored=new Map(),source=workerSource,fetchResponse,beforePut}={}){
  const listeners=new Map(),fetches=[],lifecycle=[];
  const cacheNames=new Set([...stored.keys()].map(key=>key.split('|')[0]));
  const cacheKey=key=>{const url=new URL(typeof key==='string'?key:key.url,origin);return url.pathname+url.search;};
  const self={location:{origin},clients:{claim:async()=>{lifecycle.push('claim');}},skipWaiting:async()=>{lifecycle.push('skipWaiting');},
    addEventListener:(name,handler)=>listeners.set(name,handler)};
  const caches={
    async open(name){cacheNames.add(name);return {async put(key,value){
      const path=cacheKey(key);await beforePut?.(path,value);stored.set(name+'|'+path,value.clone());},
      async match(key){return stored.get(name+'|'+cacheKey(key))?.clone()||null;}};},
    async keys(){return [...new Set([...cacheNames,...[...stored.keys()].map(key=>key.split('|')[0])])];},
    async delete(name){cacheNames.delete(name);for(const key of [...stored.keys()])if(key.startsWith(name+'|'))stored.delete(key);return true;}
  };
  const fetch=async input=>{
    const url=typeof input==='string'?new URL(input,origin):new URL(input.url);
    fetches.push(url.pathname+url.search);
    if(!network)throw TypeError('offline');
    const response=await fetchResponse?.(url.pathname+url.search);
    if(response)return response;
    if(url.pathname==='/')return new FakeResponse(shellHtml);
    return new FakeResponse('static');
  };
  vm.runInNewContext(source,{self,caches,fetch,URL,Set,Response:FakeResponse});
  return {listeners,stored,fetches,lifecycle,setNetwork(value){network=value;}};
}
async function fireLifecycle(harness,name){
  let pending;harness.listeners.get(name)({waitUntil(value){pending=value;}});await pending;
}
const fireInstall=harness=>fireLifecycle(harness,'install');
function fireFetch(harness,path='/',destination=''){
  let pending;harness.listeners.get('fetch')({request:{method:'GET',mode:path==='/'?'navigate':'cors',destination,url:origin+path},
    respondWith(value){pending=value;}});return pending;
}
async function previousVersion(stored=new Map()){
  const old=createHarness({stored,source:workerTemplate.replace('__CACHE_VERSION__','old')});
  await fireInstall(old);old.setNetwork(false);return old;
}
async function assertOldShellUsable(old){
  const navigation=await fireFetch(old),script=await fireFetch(old,'/assets/app.js','script');
  assert.equal(navigation.status,200);assert.match(await navigation.text(),/\/assets\/app\.js/);
  assert.equal(script.status,200);assert.equal(await script.text(),'static');
}

test('offline app-shell install caches only same-origin static shell assets, never API paths',async()=>{
  const h=createHarness();await fireInstall(h);
  assert.ok(h.stored.has('justelle-shell-test|/'));
  assert.ok(h.stored.has('justelle-shell-test|/assets/app.js'));
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
  assert.match(await response.text(),/\/assets\/app\.js/);
  let intercepted=false;
  h.listeners.get('fetch')({request:{method:'GET',mode:'cors',destination:'',url:origin+'/api/private'},
    respondWith(){intercepted=true;}});
  assert.equal(intercepted,false,'same-origin private API responses are never intercepted or cached');
});

for(const [label,options,expected] of [
  ['interrupted HTML download',{fetchResponse:path=>{if(path==='/')throw TypeError('interrupted');}},/interrupted/],
  ['unavailable HTML',{fetchResponse:path=>path==='/'?new FakeResponse('unavailable',503):null},/App shell unavailable/],
  ['interrupted bundle download',{fetchResponse:path=>{if(path==='/assets/app.js')throw TypeError('interrupted');}},/interrupted/],
  ['missing bundle',{fetchResponse:path=>path==='/assets/app.js'?new FakeResponse('missing',404):null},/App shell asset unavailable/],
  ['unavailable stylesheet',{fetchResponse:path=>path==='/styles.css'?new FakeResponse('unavailable',503):null},/App shell asset unavailable/],
  ['non-basic bundle',{fetchResponse:path=>path==='/assets/app.js'?new FakeResponse('opaque',200,'opaque'):null},/App shell asset unavailable/],
  ['bundle cache write failure',{beforePut:path=>{if(path==='/assets/app.js')throw Error('cache full');}},/cache full/],
  ['HTML cache write failure',{beforePut:path=>{if(path==='/')throw Error('cache full');}},/cache full/]
])test(`failed install preserves the previous offline shell: ${label}`,async()=>{
  const old=await previousVersion(),h=createHarness({stored:old.stored,...options});
  await assert.rejects(fireInstall(h),expected);
  assert.deepEqual(h.lifecycle,[],'a rejected install must not request activation or claim clients');
  assert.equal([...h.stored.keys()].some(key=>key.startsWith('justelle-shell-test|')),false,'partial candidate cache is removed');
  await assertOldShellUsable(old);
});

test('a retry discards stale partial entries and activates only a complete new shell',async()=>{
  const old=await previousVersion();let interrupted=true;
  const h=createHarness({stored:old.stored,fetchResponse:path=>{
    if(interrupted&&path==='/styles.css')throw TypeError('interrupted');
  }});
  await assert.rejects(fireInstall(h),/interrupted/);
  h.stored.set('justelle-shell-test|/stale.js',new FakeResponse('partial entry from a terminated install'));
  h.stored.set('unrelated-cache|/keep',new FakeResponse('unrelated'));
  interrupted=false;await fireInstall(h);
  assert.deepEqual(h.lifecycle,['skipWaiting']);
  assert.equal(h.stored.has('justelle-shell-test|/stale.js'),false);
  for(const path of ['/','/assets/app.js','/styles.css'])assert.ok(h.stored.has('justelle-shell-test|'+path));
  await assertOldShellUsable(old);
  await fireLifecycle(h,'activate');
  assert.deepEqual(h.lifecycle,['skipWaiting','claim']);
  assert.equal([...h.stored.keys()].some(key=>key.startsWith('justelle-shell-old|')),false);
  assert.ok(h.stored.has('unrelated-cache|/keep'));
  h.setNetwork(false);await assertOldShellUsable(h);
});

test('online next-release HTML cannot replace the installed fallback before a successful update',async()=>{
  let newer=false;
  const old=createHarness({source:workerTemplate.replace('__CACHE_VERSION__','old'),fetchResponse:path=>
    newer&&path==='/'?new FakeResponse('<script src="/assets/next.js"></script>'):null});
  await fireInstall(old);newer=true;
  assert.match(await (await fireFetch(old)).text(),/next\.js/,'online navigation still returns the current server HTML');
  const update=createHarness({stored:old.stored,fetchResponse:path=>{
    if(path==='/')return new FakeResponse('<script src="/assets/next.js"></script>');
    throw TypeError('interrupted');
  }});
  await assert.rejects(fireInstall(update),/interrupted/);
  old.setNetwork(false);await assertOldShellUsable(old);
});

test('same-HTML worker-only builds use separate caches and failed updates preserve the active shell',async t=>{
  const fixture=await mkdtemp(join(tmpdir(),'justelle-shell-build-'));
  t.after(()=>rm(fixture,{recursive:true,force:true}));
  for(const directory of ['tools','web','node_modules/vite/bin'])await mkdir(join(fixture,directory),{recursive:true});
  await copyFile(new URL('../tools/build.mjs',import.meta.url),join(fixture,'tools/build.mjs'));
  // Stub only Vite: exercise the real build script's worker generation with identical bundled HTML.
  await writeFile(join(fixture,'node_modules/vite/bin/vite.js'),
    `const fs=require('node:fs');fs.mkdirSync('dist',{recursive:true});fs.writeFileSync('dist/index.html',${JSON.stringify(shellHtml)});`);
  for(const file of ['manifest.webmanifest','justelle-caricature.png'])await writeFile(join(fixture,'web',file),'fixture');
  const buildWorker=async source=>{
    await writeFile(join(fixture,'web/offline-shell-worker.js'),source);
    await run(process.execPath,[join(fixture,'tools/build.mjs')],{cwd:fixture});
    return readFile(join(fixture,'dist/offline-shell-worker.js'),'utf8');
  };
  const first=await buildWorker(workerTemplate),second=await buildWorker(workerTemplate+'\n// Worker-only update fixture.\n');
  const cacheName=source=>source.match(/const CACHE_NAME='([^']+)'/)[1];
  assert.notEqual(cacheName(first),cacheName(second),'worker changes must not clear or rewrite the active cache');
  assert.equal(first.includes('__CACHE_VERSION__'),false);
  assert.equal(await buildWorker(workerTemplate),first,'the same build remains deterministic');
  const old=createHarness({source:first});await fireInstall(old);old.setNetwork(false);
  const update=createHarness({source:second,stored:old.stored,fetchResponse:path=>{
    if(path==='/assets/app.js')throw TypeError('interrupted');
  }});
  await assert.rejects(fireInstall(update),/interrupted/);
  assert.deepEqual(update.lifecycle,[]);
  assert.equal([...update.stored.keys()].some(key=>key.startsWith(cacheName(second)+'|')),false);
  await assertOldShellUsable(old);
});
