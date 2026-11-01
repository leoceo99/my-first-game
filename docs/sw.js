/* 파이브릿지 서비스 워커.
 *
 * 1) 앱과 파이썬 엔진 파일을 저장해 두어서, 한 번 열고 나면 인터넷 없이도 실행돼요.
 * 2) input()이 답을 기다리는 동안 파이썬 워커의 요청을 붙잡고 있다가,
 *    화면에서 답을 보내면 그 답으로 응답해요.
 */
"use strict";

const CACHE = "pybridge-v1";
const APP_FILES = [
  "./", "./index.html", "./style.css", "./worker.js", "./py/runner.py",
  "./js/app.js", "./js/editor.js", "./js/engine.js", "./js/store.js",
  "./js/highlight.js", "./js/errors.js", "./js/examples.js",
  "./manifest.webmanifest", "./icons/icon.svg", "./icons/icon-192.png", "./icons/icon-512.png",
  "./icons/apple-touch-icon.png",
];
const WAIT_MS = 15000;

const waitingRequests = new Map(); // id -> resolve 함수
const earlyAnswers = new Map();    // 요청보다 먼저 도착한 답

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

function textResponse(text, status = 200) {
  return new Response(text, {
    status,
    headers: { "Content-Type": "text/plain; charset=utf-8", "Cache-Control": "no-store" },
  });
}

function waitForAnswer(id) {
  if (earlyAnswers.has(id)) {
    const value = earlyAnswers.get(id);
    earlyAnswers.delete(id);
    return Promise.resolve(textResponse(value));
  }
  return new Promise((resolve) => {
    const timer = setTimeout(() => {
      waitingRequests.delete(id);
      resolve(new Response(null, { status: 204, headers: { "Cache-Control": "no-store" } }));
    }, WAIT_MS);
    waitingRequests.set(id, (value) => {
      clearTimeout(timer);
      resolve(textResponse(value));
    });
  });
}

self.addEventListener("message", (event) => {
  const msg = event.data || {};
  if (msg.type !== "pybridge-input") return;
  const resolve = waitingRequests.get(msg.id);
  if (resolve) {
    waitingRequests.delete(msg.id);
    resolve(msg.value);
  } else {
    earlyAnswers.set(msg.id, msg.value);
  }
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
  if (url.origin === self.location.origin && url.pathname.endsWith("/__pybridge_input__")) {
    if (url.searchParams.has("probe")) event.respondWith(textResponse("pong"));
    else event.respondWith(waitForAnswer(url.searchParams.get("id")));
    return;
  }
  if (event.request.method !== "GET") return;
  if (url.origin === self.location.origin) {
    // 엔진 파일(vendor)은 바뀌지 않으니 저장본을 먼저 써요.
    event.respondWith(url.pathname.includes("/vendor/") ? cacheFirst(event.request) : networkFirst(event.request));
  } else if (url.hostname === "cdn.jsdelivr.net" && url.pathname.includes("/pyodide")) {
    event.respondWith(cacheFirst(event.request)); // 버전이 고정된 엔진 파일
  }
});
