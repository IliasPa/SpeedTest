/* Offline shell. The page itself must work with no network, so that a
   failed test reads as "your connection is down" rather than a blank
   tab. Test data is never cached — it is the thing being measured. */

const CACHE = 'speedtest-v0.5.1';
const SHELL = [
  './', './index.html', './style.css', './i18n.js', './app.js',
  './manifest.webmanifest', './icon-192.png', './icon-512.png'
];

self.addEventListener('install', e => {
  e.waitUntil(caches.open(CACHE).then(c => c.addAll(SHELL)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', e => {
  e.waitUntil(
    caches.keys()
      .then(keys => Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', e => {
  const url = new URL(e.request.url);

  // Never touch the measurement traffic, and never cache it.
  if (url.origin !== self.location.origin) return;
  if (e.request.method !== 'GET') return;

  // Fresh when possible, cached when not.
  e.respondWith(
    fetch(e.request)
      .then(res => {
        const copy = res.clone();
        caches.open(CACHE).then(c => c.put(e.request, copy)).catch(() => {});
        return res;
      })
      .catch(() => caches.match(e.request).then(hit => {
        if (hit) return hit;
        // Only a page navigation may be answered with the page. Handing
        // index.html to a request for a script gets it parsed as HTML.
        return e.request.mode === 'navigate' ? caches.match('./index.html') : Response.error();
      }))
  );
});
