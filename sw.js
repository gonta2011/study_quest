const CACHE="study-quest-v14-public-quest";
const ASSETS=["./index.html", "./styles-v9.css?v=13", "./app-v9.js?v=13", "./manifest.webmanifest?v=5", "./icons/icon-192.png", "./icons/icon-512.png", "./icons/studyquest-icon-v2-180.png", "./assets/study-buddies-room.png", "./assets/bunny-sheet.png", "./assets/panda-sheet.png", "./assets/bunny-calm.png", "./assets/bunny-happy.png", "./assets/bunny-cheer.png", "./assets/bunny-worried.png", "./assets/panda-calm.png", "./assets/panda-happy.png", "./assets/panda-cheer.png", "./assets/panda-worried.png"];

self.addEventListener("install",e=>{
  self.skipWaiting();
  e.waitUntil(caches.open(CACHE).then(c=>c.addAll(ASSETS)));
});

self.addEventListener("activate",e=>{
  e.waitUntil((async()=>{
    const keys=await caches.keys();
    await Promise.all(keys.filter(k=>k!==CACHE).map(k=>caches.delete(k)));
    await self.clients.claim();
  })());
});

self.addEventListener("fetch",e=>{
  const req=e.request;
  const u=new URL(req.url);

  if(req.mode==="navigate"){
    e.respondWith(
      fetch(req,{cache:"no-store"})
        .then(r=>{
          const copy=r.clone();
          caches.open(CACHE).then(c=>c.put("./index.html",copy));
          return r;
        })
        .catch(()=>caches.match("./index.html"))
    );
    return;
  }

  if(u.origin===self.location.origin &&
     (u.pathname.endsWith("/styles-v9.css") || u.pathname.endsWith("/app-v9.js"))){
    e.respondWith(
      fetch(req,{cache:"no-store"})
        .then(r=>{
          const copy=r.clone();
          caches.open(CACHE).then(c=>c.put(req,copy));
          return r;
        })
        .catch(()=>caches.match(req))
    );
    return;
  }

  e.respondWith(caches.match(req).then(r=>r||fetch(req)));
});
