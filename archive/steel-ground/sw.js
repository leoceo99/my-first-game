// 오프라인 실행용 서비스 워커: 네트워크 우선, 실패 시 캐시 사용
const CACHE = 'steel-ground-v1';
const FILES = ['./', 'index.html', 'style.css', 'manifest.webmanifest',
  'js/main.js', 'js/game.js', 'js/map.js', 'js/render.js', 'js/fx.js', 'js/audio.js', 'js/ai.js', 'js/data.js', 'js/util.js',
  'icons/icon-180.png', 'icons/icon-192.png', 'icons/icon-512.png'];
self.addEventListener('install', (e) => { e.waitUntil(caches.open(CACHE).then((c) => c.addAll(FILES)).then(() => self.skipWaiting())); });
self.addEventListener('activate', (e) => { e.waitUntil(self.clients.claim()); });
self.addEventListener('fetch', (e) => {
  if (e.request.method !== 'GET') return;
  e.respondWith(fetch(e.request).then((r) => {
    const copy = r.clone();
    caches.open(CACHE).then((c) => c.put(e.request, copy));
    return r;
  }).catch(() => caches.match(e.request)));
});
