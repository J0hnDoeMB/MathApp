// Offline shell + CDN cache. The app stays local-first: the service worker
// only caches static GET assets, never /api traffic or user data.
const VERSION = "mathapp-v3";
const SHELL = [
  "/",
  "/index.html",
  "/style.css",
  "/state.js",
  "/features.js",
  "/core/format.js",
  "/core/markdown.js",
  "/core/sources.js",
  "/core/export.js",
  "/app.js",
];
const CDN = [
  "https://cdn.jsdelivr.net/npm/marked@18.1.1/lib/marked.umd.js",
  "https://cdn.jsdelivr.net/npm/katex@0.16.9/dist/katex.min.css",
  "https://cdn.jsdelivr.net/npm/katex@0.16.9/dist/katex.min.js",
  "https://cdn.jsdelivr.net/npm/katex@0.16.9/dist/contrib/auto-render.min.js",
  "https://www.geogebra.org/apps/deployggb.js",
];
const CDN_HOSTS = new Set([
  "cdn.jsdelivr.net",
  "www.geogebra.org",
  "geogebra.org",
  "fonts.googleapis.com",
  "fonts.gstatic.com",
]);

self.addEventListener("install", (event) => {
  event.waitUntil((async () => {
    const cache = await caches.open(VERSION);
    await Promise.allSettled(SHELL.map((url) => cache.add(url)));
    await Promise.allSettled(CDN.map(async (url) => {
      try {
        // CORS (non opaque): gli script con integrity/crossorigin devono restare verificabili offline.
        const res = await fetch(url, { mode: "cors", cache: "reload", signal: AbortSignal.timeout(8000) });
        if (res) await cache.put(url, res);
      } catch { /* offline install: the shell is still usable */ }
    }));
    await self.skipWaiting();
  })());
});

self.addEventListener("activate", (event) => {
  event.waitUntil((async () => {
    const keys = await caches.keys();
    await Promise.all(keys.filter((key) => key.startsWith("mathapp-") && key !== VERSION).map((key) => caches.delete(key)));
    await self.clients.claim();
  })());
});

async function networkFirst(request) {
  const cache = await caches.open(VERSION);
  try {
    const res = await fetch(request);
    if (res && res.ok) cache.put(request, res.clone()).catch(() => {});
    return res;
  } catch (e) {
    const hit = await cache.match(request, { ignoreSearch: request.mode === "navigate" });
    if (hit) return hit;
    if (request.mode === "navigate") {
      const shell = await cache.match("/index.html");
      if (shell) return shell;
    }
    throw e;
  }
}

async function cacheFirst(request) {
  const cache = await caches.open(VERSION);
  const hit = await cache.match(request);
  if (hit) return hit;
  const res = await fetch(request);
  if (res) cache.put(request, res.clone()).catch(() => {});
  return res;
}

self.addEventListener("fetch", (event) => {
  const request = event.request;
  if (request.method !== "GET") return;
  const url = new URL(request.url);
  if (url.pathname.startsWith("/api/") || url.pathname.startsWith("/__test")) return;
  if (url.origin === self.location.origin) {
    event.respondWith(networkFirst(request));
    return;
  }
  if (CDN_HOSTS.has(url.hostname)) {
    event.respondWith(cacheFirst(request));
  }
});
