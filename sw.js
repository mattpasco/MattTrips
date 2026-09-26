/**
 * Offline support. Each request goes to the network first, and each good answer goes into the
 * cache. If the network fails or is slow, the cache answers. Thus the app opens in airplane
 * mode, and a new version on GitHub Pages shows on the next launch that is online.
 * If the app loads a new file, add it to FILES.
 */
const CACHE = 'matttrips';
const FILES = ['./', 'index.html', 'parse.js', 'trips.js'];

self.addEventListener('install', e => e.waitUntil(caches.open(CACHE).then(c => c.addAll(FILES.map(f => new Request(f, { cache: 'no-cache' }))))));

self.addEventListener('fetch', e => {
  const req = e.request;
  if (req.method !== 'GET' || new URL(req.url).origin !== location.origin) return;
  // Ask the server each time (ETag check). GitHub Pages lets the browser keep old files 10 minutes.
  const network = fetch(req.url, { cache: 'no-cache' });
  // Copy the response at once: after respondWith() reads the body, clone() fails.
  e.waitUntil(network.then(res => { const copy = res.clone(); return res.ok && caches.open(CACHE).then(c => c.put(req, copy)); }).catch(() => {}));
  const slow = new Promise((_, reject) => setTimeout(reject, 4000)); // in-flight Wi-Fi can hang
  e.respondWith(Promise.race([network, slow]).catch(() =>
    caches.match(req, { ignoreSearch: true }).then(hit => hit || network)));
});
