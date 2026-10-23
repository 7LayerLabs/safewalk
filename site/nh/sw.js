// App shell is cached so the map UI opens with a weak signal on Halloween night.
// Map tiles are cached as you view them (stale-while-revalidate).
// Each state folder registers this same worker; its app cache is named after the folder so states never clear each other
const CITY = new URL(self.registration.scope).pathname.split('/').filter(Boolean).pop() || 'home';
const SHELL = `safewalk-${CITY}-shell-v8`;
const TILES = 'safewalk-tiles-v3'; // OpenFreeMap vector tiles; older caches held blocked OSM images
const SHELL_FILES = [
  './', 'index.html', 'data.js', 'manifest.webmanifest', 'icons/icon.svg', 'icons/icon-192.png',
  'https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.9.4/leaflet.min.css',
  'https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.9.4/leaflet.min.js',
  'https://cdnjs.cloudflare.com/ajax/libs/leaflet.heat/0.2.0/leaflet-heat.js',
  'https://cdnjs.cloudflare.com/ajax/libs/maplibre-gl/4.7.1/maplibre-gl.js',
  'https://cdnjs.cloudflare.com/ajax/libs/maplibre-gl/4.7.1/maplibre-gl.css',
  'https://cdn.jsdelivr.net/npm/@maplibre/maplibre-gl-leaflet@0.0.22/leaflet-maplibre-gl.js',
];

self.addEventListener('install', e => {
  e.waitUntil(caches.open(SHELL).then(c => c.addAll(SHELL_FILES)).then(() => self.skipWaiting()));
});
self.addEventListener('activate', e => {
  e.waitUntil(caches.keys().then(keys => Promise.all(keys.filter(k => (k.startsWith(`safewalk-${CITY}-`) || k.startsWith('safewalk-shell-') || (k.startsWith('safewalk-tiles-') && k !== TILES)) && k !== SHELL).map(k => caches.delete(k))))
    .then(() => self.clients.claim()));
});
self.addEventListener('fetch', e => {
  const url = new URL(e.request.url);
  if (e.request.method !== 'GET' || url.hostname.includes('nominatim')) return;
  // Tiles, glyphs and sprites never change at a given URL. The style and planet index do, so they go network first below.
  const tile = (url.hostname === 'tiles.openfreemap.org' && /\.(pbf|png|json)$/.test(url.pathname)) || url.hostname === 'tile.openstreetmap.org';
  if (tile || url.hostname.includes('fonts.g')) {
    e.respondWith(caches.open(TILES).then(async c => {
      const hit = await c.match(e.request);
      const net = fetch(e.request).then(r => { if (r.ok || r.type === 'opaque') c.put(e.request, r.clone()); return r; }).catch(() => hit);
      return hit || net;
    }));
    return;
  }
  // Network first for the app itself so data updates land, cache as fallback
  e.respondWith(fetch(e.request, { cache: 'no-cache' }).then(r => {
    if (r.ok && (url.origin === location.origin || url.hostname === 'cdnjs.cloudflare.com' || url.hostname === 'cdn.jsdelivr.net' || url.hostname === 'tiles.openfreemap.org')) {
      const copy = r.clone(); caches.open(SHELL).then(c => c.put(e.request, copy));
    }
    return r;
  }).catch(() => caches.match(e.request, { ignoreSearch: true })));
});
