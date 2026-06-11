// ══════════════════════════════════════════════════════════
// GoPlex Inventaire — Service Worker
// Stratégie :
//   • Fichiers de l'app (index.html, app.js, manifest, icônes) → RÉSEAU D'ABORD
//     (tu as toujours la dernière version en ligne, le cache sert seulement hors-ligne)
//   • Librairies CDN + polices → CACHE D'ABORD (rapide, stable)
//   • Données Supabase (lecture/écriture) → JAMAIS mises en cache (toujours le réseau)
//
// Pour forcer un rafraîchissement complet du cache après un gros changement :
//   incrémente la version ci-dessous (goplex-v1 → goplex-v2).
// ══════════════════════════════════════════════════════════
const CACHE = 'goplex-v1';

const ASSETS = [
  './',
  './index.html',
  './app.js',
  './manifest.json',
  './icon-192.png',
  './icon-512.png',
  'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2',
  'https://cdn.jsdelivr.net/npm/jsbarcode@3.11.6/dist/JsBarcode.all.min.js',
  'https://cdn.jsdelivr.net/npm/@tabler/icons-webfont@3.19.0/dist/tabler-icons.min.css'
];

self.addEventListener('install', e => {
  e.waitUntil(
    caches.open(CACHE)
      .then(c => c.addAll(ASSETS).catch(()=>{}))   // si un asset échoue, on n'empêche pas l'install
      .then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', e => {
  e.waitUntil(
    caches.keys()
      .then(keys => Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', e => {
  const req = e.request;
  if (req.method !== 'GET') return;                 // ne touche jamais aux POST/PATCH (écritures Supabase)

  const url = new URL(req.url);

  // Données live Supabase → laisser passer au réseau, ne rien cacher
  if (url.hostname.endsWith('supabase.co')) return;

  const sameOrigin = url.origin === self.location.origin;

  if (sameOrigin) {
    // Nos fichiers : réseau d'abord, cache en repli hors-ligne
    e.respondWith(
      fetch(req)
        .then(res => {
          if (res && res.status === 200) {
            const copy = res.clone();
            caches.open(CACHE).then(c => c.put(req, copy));
          }
          return res;
        })
        .catch(() => caches.match(req).then(r => r || caches.match('./index.html')))
    );
  } else {
    // CDN / polices : cache d'abord, réseau en repli
    e.respondWith(
      caches.match(req).then(cached =>
        cached || fetch(req).then(res => {
          if (res && res.status === 200) {
            const copy = res.clone();
            caches.open(CACHE).then(c => c.put(req, copy));
          }
          return res;
        }).catch(() => cached)
      )
    );
  }
});
