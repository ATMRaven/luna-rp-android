const CACHE_NAME = 'luna-rp-shell-v3';
const SHELL_ASSETS = [
    '/',
    '/index.html',
    '/style.css',
    '/download-app.js',
    '/app.js',
    '/manifest.json',
    '/avatars/luna.png'
];

self.addEventListener('install', (event) => {
    event.waitUntil(
        caches.open(CACHE_NAME).then((cache) => cache.addAll(SHELL_ASSETS)).then(() => self.skipWaiting())
    );
});

self.addEventListener('activate', (event) => {
    event.waitUntil(
        caches.keys().then((keys) =>
            Promise.all(keys.filter((k) => k !== CACHE_NAME).map((k) => caches.delete(k)))
        ).then(() => self.clients.claim())
    );
});

self.addEventListener('fetch', (event) => {
    const req = event.request;
    const url = new URL(req.url);

    // Always go straight to network for API calls and non-GET requests
    if (req.method !== 'GET' || url.pathname.startsWith('/api/')) {
        return;
    }

    // Network-first with cache fallback for mobile WebAPK shell reliability
    event.respondWith(
        fetch(req)
            .then((res) => {
                if (res && res.status === 200 && url.origin === self.location.origin) {
                    const copy = res.clone();
                    caches.open(CACHE_NAME).then((cache) => cache.put(req, copy));
                }
                return res;
            })
            .catch(() => caches.match(req))
    );
});
