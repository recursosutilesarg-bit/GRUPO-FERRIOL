// Service Worker — Ferriol OS PWA
const CACHE_NAME = 'ferriol-os-v1';
const ASSETS = [
  './kiosco.html',
  './manifest.json',
  './icons/icon-192.svg',
  './icons/icon-512.svg'
];

// Instalación: cachear recursos esenciales
self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then((cache) => cache.addAll(ASSETS))
      .then(() => self.skipWaiting())
      .catch((err) => console.warn('SW install cache:', err))
  );
});

// Activación: limpiar caches antiguos
self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(keys.filter((k) => k !== CACHE_NAME).map((k) => caches.delete(k)))
    ).then(() => self.clients.claim())
  );
});

// Estrategia: red primero para navegación y API; cache primero para assets estáticos
self.addEventListener('fetch', (event) => {
  const { request } = event;
  const url = new URL(request.url);

  // Solo mismo origen
  if (url.origin !== location.origin) {
    return;
  }

  // Página principal: red primero, fallback a cache
  if (request.mode === 'navigate' || request.destination === 'document') {
    event.respondWith(
      fetch(request).catch(() => caches.match('./kiosco.html').then((r) => r || caches.match(request)))
    );
    return;
  }

  // Manifest e iconos: cache primero
  if (url.pathname.endsWith('manifest.json') || url.pathname.includes('/icons/')) {
    event.respondWith(
      caches.match(request).then((cached) => cached || fetch(request).then((res) => {
        const clone = res.clone();
        caches.open(CACHE_NAME).then((cache) => cache.put(request, clone));
        return res;
      }))
    );
    return;
  }

  // Resto: red primero
  event.respondWith(fetch(request).catch(() => caches.match(request)));
});
