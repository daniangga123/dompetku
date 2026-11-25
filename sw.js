/* DompetKu — Service Worker
   Menyimpan tampilan aplikasi di HP agar terbuka instan.
   Data keuangan TIDAK disimpan di sini (permintaan ke Apps Script selalu langsung). */
const CACHE = 'dompetku-v2';
const SHELL = ['./', 'index.html', 'style.css', 'app.js', 'manifest.webmanifest', 'icons/icon-192.png', 'icons/icon-512.png'];

self.addEventListener('install', e => {
  e.waitUntil(caches.open(CACHE).then(c => c.addAll(SHELL)).then(() => self.skipWaiting()));
});
self.addEventListener('activate', e => {
  e.waitUntil(caches.keys().then(keys => Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k)))).then(() => self.clients.claim()));
});
self.addEventListener('fetch', e => {
  const req = e.request;
  if (req.method !== 'GET') return;                       // permintaan data (POST) tidak disentuh
  const url = new URL(req.url);
  if (url.hostname.endsWith('google.com') && !url.hostname.startsWith('fonts')) return;
  // Stale-while-revalidate: tampilkan versi tersimpan, perbarui diam-diam di belakang
  e.respondWith(caches.open(CACHE).then(async cache => {
    const cached = await cache.match(req, { ignoreSearch: req.mode === 'navigate' });
    const network = fetch(req).then(res => {
      if (res && (res.ok || res.type === 'opaque')) cache.put(req, res.clone());
      return res;
    }).catch(() => cached);
    return cached || network;
  }));
});
