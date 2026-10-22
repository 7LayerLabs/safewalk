// Cross-checks every Census geocode against OpenStreetMap; prints the ones more than 150 m apart.
import { readFileSync } from 'node:fs';
const cache = JSON.parse(readFileSync('data/geocache.json', 'utf8'));
const out = [];
for (const [k, v] of Object.entries(cache)) {
  if (v.src !== 'census') continue;
  const [street, zip] = k.split('|');
  const url = `https://nominatim.openstreetmap.org/search?format=json&limit=1&countrycodes=us&street=${encodeURIComponent(street)}&state=MA&postalcode=${zip}`;
  const h = (await (await fetch(url, { headers: { 'User-Agent': 'SafeWalkLowell/1.0 (derek.bobola@gmail.com)' } })).json())[0];
  await new Promise(r => setTimeout(r, 1100));
  if (!h || h.class === 'highway') continue; // OSM only knows the street; nothing better to compare
  const d = Math.hypot((+h.lat - v.lat) * 111000, (+h.lon - v.lng) * 82000);
  if (d > 150) out.push({ k, d: Math.round(d), osm: [+h.lat, +h.lon], name: h.display_name.split(',').slice(0, 3).join(',') });
}
console.log(JSON.stringify(out, null, 1));
