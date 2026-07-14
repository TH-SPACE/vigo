/* Service worker — Vistoria de Ocorrências (PWA)
   Estratégia: network-first para navegação/dados (sempre que online traz o
   conteúdo fresco), com cache de fallback para os assets estáticos. */
'use strict';

const CACHE = 'vistoria-v1';
const ASSETS = [
  '/css/app.css',
  '/js/app.js',
  '/js/painel.js',
  '/manifest.webmanifest',
  '/icons/icon-192.png',
  '/icons/icon-512.png',
  '/svg/vivo-aura-purpura-centro-320x320.svg',
];

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(ASSETS)).catch(() => {}));
  self.skipWaiting();
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys().then((ks) => Promise.all(ks.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
  );
  self.clients.claim();
});

self.addEventListener('fetch', (e) => {
  const req = e.request;
  if (req.method !== 'GET') return;                 // não intercepta POST (login, formulários)
  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return;  // só recursos do próprio app
  if (url.pathname === '/api/notificacoes/stream') return; // SSE: stream infinito, não interceptar/cachear

  // Assets estáticos: cache-first (rápido e funciona offline)
  if (/\.(css|js|png|svg|webmanifest|woff2?)$/.test(url.pathname)) {
    e.respondWith(
      caches.match(req).then((hit) => hit || fetch(req).then((resp) => {
        const copy = resp.clone();
        caches.open(CACHE).then((c) => c.put(req, copy)).catch(() => {});
        return resp;
      }).catch(() => hit))
    );
    return;
  }

  // Navegação / dados: network-first, cai pro cache se offline
  e.respondWith(
    fetch(req).then((resp) => {
      const copy = resp.clone();
      caches.open(CACHE).then((c) => c.put(req, copy)).catch(() => {});
      return resp;
    }).catch(() => caches.match(req))
  );
});
