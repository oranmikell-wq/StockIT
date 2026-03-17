// Service Worker — StockIT PWA
const CACHE = 'stockit-v1';
const STATIC = [
  '/StockIT/',
  '/StockIT/index.html',
  '/StockIT/css/main.css',
  '/StockIT/css/home.css',
  '/StockIT/css/results.css',
  '/StockIT/css/compare.css',
  '/StockIT/js/i18n.js',
  '/StockIT/js/api.js',
  '/StockIT/js/scoring.js',
  '/StockIT/js/chart.js',
  '/StockIT/js/watchlist.js',
  '/StockIT/js/compare.js',
  '/StockIT/js/app.js',
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
