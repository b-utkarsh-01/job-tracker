const CACHE = 'job-tracker-v2';
const SHELL = ['/', '/index.html', '/style.css', '/app.js', '/manifest.json'];

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(CACHE).then(cache => cache.addAll(SHELL)));
  self.skipWaiting();
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys().then(keys =>
      Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k)))
    )
  );
  self.clients.claim();
});

// Network-first everywhere: always try to fetch the latest file first (so a
// normal reload always shows the newest deploy), and only fall back to the
// cached copy if the network request actually fails (i.e. truly offline).
// This also means the site correctly stops working when the server is down,
// instead of silently serving a stale cached page.
self.addEventListener('fetch', (e) => {
  e.respondWith(
    fetch(e.request)
      .then(res => {
        // keep the cache fresh with whatever we just fetched successfully
        const resClone = res.clone();
        caches.open(CACHE).then(cache => cache.put(e.request, resClone));
        return res;
      })
      .catch(() => caches.match(e.request))
  );
});