// Service Worker — BuyorNot PWA
const CACHE = 'buyornot-v1';
const STATIC = [
  '/buyornot/',
  '/buyornot/index.html',
  '/buyornot/css/main.css',
  '/buyornot/css/home.css',
  '/buyornot/css/results.css',
  '/buyornot/css/compare.css',
  '/buyornot/js/i18n.js',
  '/buyornot/js/api.js',
  '/buyornot/js/scoring.js',
  '/buyornot/js/chart.js',
  '/buyornot/js/watchlist.js',
  '/buyornot/js/compare.js',
  '/buyornot/js/app.js',
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
