const CACHE_NAME='justelle-shell-__CACHE_VERSION__';
const STATIC_PATHS=new Set(['/','/index.html','/manifest.webmanifest','/justelle-caricature.png']);
const isAppShellPath=path=>STATIC_PATHS.has(path)||path.startsWith('/assets/')||path.startsWith('/@vite/')||
  path.startsWith('/node_modules/.vite/')||
  (path!=='/api'&&!path.startsWith('/api/')&&/\.(?:mjs|js|css|png|svg|webp|woff2?)$/.test(path));

self.addEventListener('install',event=>{
  event.waitUntil((async()=>{
    const response=await fetch('/',{cache:'no-store'});
    if(!response.ok)throw Error('App shell unavailable during offline preparation');
    const html=await response.clone().text(),paths=new Set(['/']);
    for(const match of html.matchAll(/\b(?:src|href)=["']([^"']+)["']/g)){
      try{
        const url=new URL(match[1],self.location.origin);
        if(url.origin===self.location.origin&&isAppShellPath(url.pathname))paths.add(url.pathname+url.search);
      }catch{}
    }
    const cache=await caches.open(CACHE_NAME);await cache.put('/',response.clone());
    for(const path of paths){
      if(path==='/')continue;
      try{
        const asset=await fetch(path,{cache:'no-store'});
        if(asset.ok&&asset.type==='basic')await cache.put(path,asset);
      }catch{}
    }
    await self.skipWaiting();
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
      if(response.ok&&response.type==='basic')await cache.put(navigation?'/':request,response.clone());
      return response;
    }catch{
      const cached=await cache.match(navigation?'/':request);
      return cached||new Response('Offline app shell is not available on this device.',
        {status:503,headers:{'Content-Type':'text/plain; charset=utf-8'}});
    }
  })());
});
