const CACHE='demax-evidencija-v22-drive-backup-20261024';const FILES=['./','./index.html','./icon.svg','./favicon-beli-v21-192.png','./favicon-beli-v21-512.png','./manifest.json','./drive-backup.js'];
self.addEventListener('install',event=>{event.waitUntil(caches.open(CACHE).then(cache=>cache.addAll(FILES)));self.skipWaiting()});
self.addEventListener('activate',event=>{event.waitUntil(caches.keys().then(keys=>Promise.all(keys.filter(k=>k.startsWith('demax-evidencija-v')&&k!==CACHE).map(k=>caches.delete(k)))));self.clients.claim()});
self.addEventListener('fetch',event=>{
 if(event.request.method!=='GET'||new URL(event.request.url).origin!==self.location.origin)return;
 event.respondWith(fetch(event.request).then(response=>{
  if(response&&response.ok){const copy=response.clone();caches.open(CACHE).then(cache=>cache.put(event.request,copy)).catch(()=>{})}
  return response;
 }).catch(()=>caches.match(event.request)));
});