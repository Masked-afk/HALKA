const SHELL = 'halka-shell-v2';
const RUNTIME = 'halka-rt-v2';
const SHELL_FILES = ['/', '/index.html', '/assets/js/app.js', '/assets/css/styles.css', '/manifest.webmanifest'];

self.addEventListener('install', e => {
  e.waitUntil(caches.open(SHELL).then(c => c.addAll(SHELL_FILES)).then(() => self.skipWaiting()));
});
self.addEventListener('activate', e => {
  e.waitUntil(
    caches.keys()
      .then(ks => Promise.all(ks.filter(k => ![SHELL, RUNTIME].includes(k)).map(k => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});
self.addEventListener('fetch', e => {
  if (e.request.method !== 'GET') return;
  const u = new URL(e.request.url);
  // Uygulama kabuğu: önce ağ, düşerse cache — güncellemeler anında gelsin.
  if (u.origin === location.origin && (SHELL_FILES.includes(u.pathname) || u.pathname === '/')) {
    e.respondWith(
      fetch(e.request).then(r => {
        if (r.ok) { const cl = r.clone(); caches.open(SHELL).then(c => c.put(e.request, cl)); }
        return r;
      }).catch(() => caches.match(e.request))
    );
    return;
  }
  // Statik/medyalar: stale-while-revalidate.
  const cacheable =
    (u.origin === location.origin && /\.(png|jpg|webp|svg|woff2?)$/.test(u.pathname)) ||
    (u.hostname.endsWith('.supabase.co') && u.pathname.startsWith('/storage/')) ||
    u.hostname === 'fonts.googleapis.com' || u.hostname === 'fonts.gstatic.com' ||
    u.hostname.endsWith('.giphy.com');
  if (!cacheable) return;
  e.respondWith(caches.open(RUNTIME).then(async c => {
    const cached = await c.match(e.request);
    const net = fetch(e.request)
      .then(r => { if (r.ok || r.type === 'opaque') c.put(e.request, r.clone()); return r; })
      .catch(() => cached);
    return cached || net;
  }));
});
