// Fills data/geocache.json for every mappable address: US Census batch first, OpenStreetMap for misses.
// Already-cached addresses are skipped, so re-running after a registry refresh only looks up new ones.
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { readRegistry, geoKey } from './registry.mjs';

const CACHE = 'data/geocache.json';
const cache = existsSync(CACHE) ? JSON.parse(readFileSync(CACHE, 'utf8')) : {};
const todo = new Map();
for (const r of readRegistry()) if (r.mappable && !cache[geoKey(r)]) todo.set(geoKey(r), r);
console.log(`${todo.size} addresses to geocode (${Object.keys(cache).length} cached)`);

if (todo.size) {
  const keys = [...todo.keys()];
  const csv = keys.map((k, i) => { const r = todo.get(k); return `${i},"${r.street}","${r.city}",MA,${r.zip}`; }).join('\n');
  const fd = new FormData();
  fd.append('addressFile', new Blob([csv], { type: 'text/csv' }), 'batch.csv');
  fd.append('benchmark', 'Public_AR_Current');
  const text = await (await fetch('https://geocoding.geo.census.gov/geocoder/locations/addressbatch', { method: 'POST', body: fd })).text();
  for (const line of text.trim().split(/\r?\n/)) {
    const f = [...line.matchAll(/"([^"]*)"/g)].map(m => m[1]);
    if (f[2] !== 'Match') continue;
    const [lng, lat] = f[5].split(',').map(Number);
    cache[keys[+f[0]]] = { lat, lng, src: 'census', matched: f[4] };
  }
  for (const k of keys) {
    if (cache[k]) continue;
    const r = todo.get(k);
    const url = 'https://nominatim.openstreetmap.org/search?format=json&limit=1&countrycodes=us&street=' + encodeURIComponent(r.street)
      + '&city=' + encodeURIComponent(r.city) + '&state=MA&postalcode=' + r.zip;
    const hits = await (await fetch(url, { headers: { 'User-Agent': 'SafeWalkLowell/1.0 (derek.bobola@gmail.com)' } })).json();
    const h = hits[0];
    // A match on the road itself (no building) is kept but flagged approximate; the app says so on the pin
    if (h) {
      cache[k] = { lat: +h.lat, lng: +h.lon, src: 'osm', matched: h.display_name.split(',').slice(0, 3).join(','), ...(h.class === 'highway' ? { approx: true } : {}) };
    } else {
      console.log('UNMATCHED', k, h ? `(osm: ${h.class}/${h.type} ${h.display_name.split(',').slice(0, 2).join(',')})` : '');
    }
    await new Promise(res => setTimeout(res, 1100)); // Nominatim: 1 request per second
  }
  writeFileSync(CACHE, JSON.stringify(cache, null, 1));
}
const missing = [...new Set(readRegistry().filter(r => r.mappable && !cache[geoKey(r)]).map(geoKey))];
console.log(missing.length ? `Still missing (add to data/geocache.json by hand, src "manual"): ${missing.join('; ')}` : 'All mappable addresses geocoded.');
