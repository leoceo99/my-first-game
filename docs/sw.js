/* 파이브릿지 서비스 워커.
 *
 * 앱과 파이썬 엔진 파일을 저장해 두어서, 한 번 열고 나면 인터넷 없이도 실행돼요.
 */
"use strict";

const CACHE = "pybridge-v2";
const APP_FILES = [
  "./", "./index.html", "./style.css", "./worker.js", "./py/runner.py",
  "./js/app.js", "./js/editor.js", "./js/engine.js", "./js/store.js",
  "./js/highlight.js", "./js/errors.js", "./js/examples.js",
  "./manifest.webmanifest", "./icons/icon.svg", "./icons/icon-192.png", "./icons/icon-512.png",
  "./icons/apple-touch-icon.png",
];

self.addEventListener("install", (event) => {
  event.waitUntil(caches.open(CACHE).then((cache) => cache.addAll(APP_FILES)).catch(() => {}));
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil((async () => {
    for (const key of await caches.keys()) if (key !== CACHE) await caches.delete(key);
    await self.clients.claim();
  })());
});

async function networkFirst(request) {
  const cache = await caches.open(CACHE);
  try {
    const response = await fetch(request);
    if (response.ok) cache.put(request, response.clone());
    return response;
  } catch (err) {
    const cached = await cache.match(request, { ignoreSearch: true });
    if (cached) return cached;
    throw err;
  }
}

async function cacheFirst(request) {
  const cache = await caches.open(CACHE);
  const cached = await cache.match(request);
  if (cached) return cached;
  const response = await fetch(request);
  if (response.ok) cache.put(request, response.clone());
  return response;
}

self.addEventListener("fetch", (event) => {
  const url = new URL(event.request.url);
  if (event.request.method !== "GET") return;
  if (url.origin === self.location.origin) {
    // 엔진 파일(vendor)은 바뀌지 않으니 저장본을 먼저 써요.
    event.respondWith(url.pathname.includes("/vendor/") ? cacheFirst(event.request) : networkFirst(event.request));
  } else if (url.hostname === "cdn.jsdelivr.net" && url.pathname.includes("/pyodide")) {
    event.respondWith(cacheFirst(event.request)); // 버전이 고정된 엔진 파일
  }
});
