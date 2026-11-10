// Service worker: network-first for the app shell so updates reach clinicians
// immediately, with a cached copy as the offline fallback.
const CACHE_NAME = 'merowe-his-v3';
const ASSETS = [
    './',
    './index.html',
    './styles.css',
    './logo-data.js',
    './db.js',
    './app.js',
    './clinical.js',
    './docs.js',
    './manifest.json',
    './1000008518_2.png'
];

self.addEventListener('install', (event) => {
    event.waitUntil(
        caches.open(CACHE_NAME)
            .then((cache) => cache.addAll(ASSETS))
            .then(() => self.skipWaiting())
    );
});

self.addEventListener('activate', (event) => {
    event.waitUntil(
        caches.keys()
            .then((keys) => Promise.all(keys.filter((k) => k !== CACHE_NAME).map((k) => caches.delete(k))))
            .then(() => self.clients.claim())
    );
});

self.addEventListener('fetch', (event) => {
    const req = event.request;
    if (req.method !== 'GET') return;
    event.respondWith(
        fetch(req)
            .then((res) => {
                if (res && res.status === 200 && res.type === 'basic') {
                    const copy = res.clone();
                    caches.open(CACHE_NAME).then((cache) => cache.put(req, copy));
                }
                return res;
            })
            .catch(() => caches.match(req).then((hit) => hit || caches.match('./index.html')))
    );
});
