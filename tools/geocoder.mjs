// Shared lookups for data/geocache.json: US Census batch first, OpenStreetMap for misses.
// Already-cached addresses are skipped, so re-running after a registry refresh only looks up new ones.
// rows: [{ street, city, zip, mappable }], keyed by geoKey (street|zip). Each state keeps its own cache file so pulls can run side by side.
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { geoKey } from './registry.mjs';

export const cacheFile = state => state === 'NH' ? 'data/geocache-nh.json' : 'data/geocache.json';
export const loadCache = state => existsSync(cacheFile(state)) ? JSON.parse(readFileSync(cacheFile(state), 'utf8')) : {};

export async function geocodeMissing(rows, state) {
  const CACHE = cacheFile(state);
  const cache = loadCache(state);
  const todo = new Map();
  for (const r of rows) if (r.mappable && !cache[geoKey(r)]) todo.set(geoKey(r), r);
  console.log(`${todo.size} addresses to geocode (${Object.keys(cache).length} cached)`);
  if (todo.size) {
    const keys = [...todo.keys()];
    for (let start = 0; start < keys.length; start += 9000) {
      const csv = keys.slice(start, start + 9000).map((k, j) => { const r = todo.get(k); return `${start + j},"${r.street}","${r.city}",${state},${r.zip}`; }).join('\n');
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
      writeFileSync(CACHE, JSON.stringify(cache, null, 1));
      console.log(`census batch ${start}: ${Object.keys(cache).length} cached`);
    }
    for (const k of keys) {
      if (cache[k]) continue;
      const r = todo.get(k);
      const url = 'https://nominatim.openstreetmap.org/search?format=json&limit=1&countrycodes=us&street=' + encodeURIComponent(r.street)
        + '&city=' + encodeURIComponent(r.city) + `&state=${state}&postalcode=` + r.zip;
      const hits = await (await fetch(url, { headers: { 'User-Agent': 'SafeWalk/1.0 (derek.bobola@gmail.com)' } })).json();
      const h = hits[0];
      // A match on the road itself (no building) is kept but flagged approximate; the app says so on the pin
      if (h) {
        cache[k] = { lat: +h.lat, lng: +h.lon, src: 'osm', matched: h.display_name.split(',').slice(0, 3).join(','), ...(h.class === 'highway' ? { approx: true } : {}) };
      } else {
        console.log('UNMATCHED', k);
      }
      await new Promise(res => setTimeout(res, 1100)); // Nominatim: 1 request per second
    }
    writeFileSync(CACHE, JSON.stringify(cache, null, 1));
  }
  const missing = [...new Set(rows.filter(r => r.mappable && !cache[geoKey(r)]).map(geoKey))];
  console.log(missing.length ? `Still missing (add to data/geocache.json by hand, src "manual"): ${missing.join('; ')}` : 'All mappable addresses geocoded.');
  return cache;
}
