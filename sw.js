// Service Worker — BuyorNot PWA
const CACHE = 'buyornot-v1';
const STATIC = [
  '/newapp/',
  '/newapp/index.html',
  '/newapp/css/main.css',
  '/newapp/css/home.css',
  '/newapp/css/results.css',
  '/newapp/css/compare.css',
  '/newapp/js/i18n.js',
  '/newapp/js/api.js',
  '/newapp/js/scoring.js',
  '/newapp/js/chart.js',
  '/newapp/js/watchlist.js',
  '/newapp/js/compare.js',
  '/newapp/js/app.js',
];

self.addEventListener('install', e => {
  e.waitUntil(caches.open(CACHE).then(c => c.addAll(STATIC)));
  self.skipWaiting();
});

self.addEventListener('activate', e => {
  e.waitUntil(
    caches.keys().then(keys =>
      Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k)))
    )
  );
  self.clients.claim();
});

self.addEventListener('fetch', e => {
  // Network first for API calls, cache first for static
  const url = e.request.url;
  if (url.includes('finance.yahoo') || url.includes('finnhub') || url.includes('financialmodelingprep') || url.includes('corsproxy')) {
    e.respondWith(
      fetch(e.request).catch(() => caches.match(e.request))
    );
  } else {
    e.respondWith(
      caches.match(e.request).then(cached => cached || fetch(e.request))
    );
  }
});
