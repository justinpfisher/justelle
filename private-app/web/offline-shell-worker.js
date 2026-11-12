const CACHE_NAME='justelle-shell-__CACHE_VERSION__';
const STATIC_PATHS=new Set(['/','/index.html','/manifest.webmanifest','/justelle-caricature.png']);
const isAppShellPath=path=>STATIC_PATHS.has(path)||path.startsWith('/assets/')||path.startsWith('/@vite/')||
  path.startsWith('/node_modules/.vite/')||
  (path!=='/api'&&!path.startsWith('/api/')&&/\.(?:mjs|js|css|png|svg|webp|woff2?)$/.test(path));

self.addEventListener('install',event=>{
  event.waitUntil((async()=>{
    // Build versions include the worker source, so this cannot clear the active version.
    // A terminated install may leave partial entries; never reuse them on a retry.
    await caches.delete(CACHE_NAME);
    try{
      const response=await fetch('/',{cache:'no-store'});
      if(!response.ok||response.type!=='basic')throw Error('App shell unavailable during offline preparation');
      const html=await response.clone().text(),paths=new Set();
      for(const match of html.matchAll(/\b(?:src|href)=["']([^"']+)["']/g)){
        try{
          const url=new URL(match[1],self.location.origin);
          if(url.origin===self.location.origin&&url.pathname!=='/'&&isAppShellPath(url.pathname))paths.add(url.pathname+url.search);
        }catch{}
      }
      const cache=await caches.open(CACHE_NAME);
      for(const path of paths){
        const asset=await fetch(path,{cache:'no-store'});
        if(!asset.ok||asset.type!=='basic')throw Error('App shell asset unavailable during offline preparation');
        await cache.put(path,asset);
      }
      await cache.put('/',response);
      await self.skipWaiting();
    }catch(error){
      await caches.delete(CACHE_NAME);
      throw error;
    }
  })());
});

self.addEventListener('activate',event=>{
  event.waitUntil((async()=>{
    for(const name of await caches.keys())if(name.startsWith('justelle-shell-')&&name!==CACHE_NAME)
      await caches.delete(name);
    await self.clients.claim();
  })());
});

self.addEventListener('fetch',event=>{
  const request=event.request;
  if(request.method!=='GET')return;
  const url=new URL(request.url);
  if(url.origin!==self.location.origin||url.pathname==='/api'||url.pathname.startsWith('/api/'))return;
  const navigation=request.mode==='navigate'&&url.pathname==='/';
  const shellAsset=request.destination!==''&&isAppShellPath(url.pathname);
  if(!navigation&&!shellAsset)return;
  event.respondWith((async()=>{
    const cache=await caches.open(CACHE_NAME);
    try{
      const response=await fetch(request);
      // Keep the installed HTML paired with its complete shell until the next worker activates.
      if(!navigation&&response.ok&&response.type==='basic')await cache.put(request,response.clone());
      return response;
    }catch{
      const cached=await cache.match(navigation?'/':request);
      return cached||new Response('Offline app shell is not available on this device.',
        {status:503,headers:{'Content-Type':'text/plain; charset=utf-8'}});
    }
  })());
});
