const CACHE_NAME = 'gc-shell-v82';

self.addEventListener('install', (event) => {
    self.skipWaiting();
});

self.addEventListener('activate', (event) => {
    event.waitUntil(
        caches.keys().then(keys =>
            Promise.all(keys.filter(k => k !== CACHE_NAME).map(k => caches.delete(k)))
        ).then(() => self.clients.claim())
    );
});

self.addEventListener('fetch', (event) => {
    const req = event.request;
    if (req.method !== 'GET') return;
    const url = new URL(req.url);
    if (url.origin !== self.location.origin) return;
    // Never intercept Socket.IO, API calls, or dynamic media
    if (url.pathname.startsWith('/socket.io') || url.pathname.startsWith('/api/')) return;

    // Always try network first so users always get latest deploys, fallback to cache if offline
    event.respondWith(
        fetch(req).then(res => {
            if (res && res.ok && (url.pathname === '/' || url.pathname.endsWith('.css') || url.pathname.endsWith('.js') || url.pathname.endsWith('.svg') || url.pathname.endsWith('.webmanifest'))) {
                const copy = res.clone();
                caches.open(CACHE_NAME).then(c => c.put(req, copy)).catch(() => {});
            }
            return res;
        }).catch(() => caches.match(req))
    );
});
