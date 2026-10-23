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

// Per-state settings for the wrong-street check and the OpenStreetMap retry below.
// names: spellings of the state that appear in road names ("NH RT 118", "Massachusetts Avenue", "MASS AVE").
// villages: registry town names that OSM may not know as a place, mapped to the town they belong to (tried second).
const BOSTON = ['DORCHESTER', 'DORCHESTER CENTER', 'ROXBURY', 'ROXBURY CROSSING', 'MISSION HILL', 'MATTAPAN', 'HYDE PARK', 'READVILLE', 'JAMAICA PLAIN',
  'ROSLINDALE', 'WEST ROXBURY', 'EAST BOSTON', 'SOUTH BOSTON', 'CHARLESTOWN', 'BRIGHTON', 'ALLSTON'];
const MA_VILLAGES = {
  ...Object.fromEntries(BOSTON.map(v => [v, 'BOSTON'])),
  HYANNIS: 'BARNSTABLE', CENTERVILLE: 'BARNSTABLE', OSTERVILLE: 'BARNSTABLE', COTUIT: 'BARNSTABLE', 'MARSTONS MILLS': 'BARNSTABLE', 'WEST BARNSTABLE': 'BARNSTABLE',
  'SOUTH YARMOUTH': 'YARMOUTH', 'WEST YARMOUTH': 'YARMOUTH', 'YARMOUTH PORT': 'YARMOUTH', 'SOUTH DENNIS': 'DENNIS', 'EAST DENNIS': 'DENNIS', 'WEST DENNIS': 'DENNIS',
  'DENNIS PORT': 'DENNIS', 'WEST HARWICH': 'HARWICH', 'HARWICH PORT': 'HARWICH', 'EAST FALMOUTH': 'FALMOUTH', 'NORTH FALMOUTH': 'FALMOUTH', 'WEST FALMOUTH': 'FALMOUTH',
  TEATICKET: 'FALMOUTH', WAQUOIT: 'FALMOUTH', 'NORTH TRURO': 'TRURO', 'SOUTH CHATHAM': 'CHATHAM', 'EAST SANDWICH': 'SANDWICH', FORESTDALE: 'SANDWICH',
  'BUZZARDS BAY': 'BOURNE', SAGAMORE: 'BOURNE', POCASSET: 'BOURNE', CATAUMET: 'BOURNE', 'SOUTH LEE': 'LEE', HOUSATONIC: 'GREAT BARRINGTON',
  'EAST FREETOWN': 'FREETOWN', ASSONET: 'FREETOWN', 'SOUTH EASTON': 'EASTON', 'NORTH EASTON': 'EASTON', 'NORTH DIGHTON': 'DIGHTON', 'EAST TAUNTON': 'TAUNTON',
  'NORTH DARTMOUTH': 'DARTMOUTH', 'SOUTH DARTMOUTH': 'DARTMOUTH', 'NORTH ATTLEBORO': 'NORTH ATTLEBOROUGH', 'SOUTH HAMILTON': 'HAMILTON', 'SOUTH DEERFIELD': 'DEERFIELD',
  'NORTH BILLERICA': 'BILLERICA', 'NORTH CHELMSFORD': 'CHELMSFORD', 'SOUTH WEYMOUTH': 'WEYMOUTH', 'EAST WEYMOUTH': 'WEYMOUTH', 'NORTH WEYMOUTH': 'WEYMOUTH',
  'EAST WAREHAM': 'WAREHAM', 'WEST WAREHAM': 'WAREHAM', ONSET: 'WAREHAM', MANOMET: 'PLYMOUTH', 'SOUTH GRAFTON': 'GRAFTON', 'NORTH GRAFTON': 'GRAFTON',
  'WEST WARREN': 'WARREN', 'INDIAN ORCHARD': 'SPRINGFIELD', FLORENCE: 'NORTHAMPTON', LEEDS: 'NORTHAMPTON', 'TURNERS FALLS': 'MONTAGUE', 'MILLERS FALLS': 'MONTAGUE',
  WHITINSVILLE: 'NORTHBRIDGE', FISKDALE: 'STURBRIDGE', BALDWINVILLE: 'TEMPLETON', BYFIELD: 'NEWBURY', JEFFERSON: 'HOLDEN', 'SOUTH LANCASTER': 'LANCASTER',
  'FEEDING HILLS': 'AGAWAM', 'CHERRY VALLEY': 'LEICESTER', ROCHDALE: 'LEICESTER', 'THREE RIVERS': 'PALMER', BONDSVILLE: 'PALMER', THORNDIKE: 'PALMER', 'NORTH OXFORD': 'OXFORD',
  NEWTONVILLE: 'NEWTON', 'NEWTON CENTER': 'NEWTON', 'WEST NEWTON': 'NEWTON', AUBURNDALE: 'NEWTON', WABAN: 'NEWTON', 'NEWTON HIGHLANDS': 'NEWTON',
  'NEWTON UPPER FALLS': 'NEWTON', 'NEWTON LOWER FALLS': 'NEWTON',
};
export const STATES = {
  NH: { box: { latMin: 42.69, latMax: 45.31, lngMin: -72.56, lngMax: -70.60 }, names: ['NEW HAMPSHIRE', 'N H'], villages: {} },
  MA: { box: { latMin: 41.18, latMax: 42.89, lngMin: -73.51, lngMax: -69.86 }, names: ['MASSACHUSETTS', 'MASS', 'M A'], villages: MA_VILLAGES },
};
export const inState = (g, state) => { const b = STATES[state].box; return g.lat >= b.latMin && g.lat <= b.latMax && g.lng >= b.lngMin && g.lng <= b.lngMax; };

const NUMS = { FIRST: '1ST', SECOND: '2ND', THIRD: '3RD', FOURTH: '4TH', FIFTH: '5TH', SIXTH: '6TH', SEVENTH: '7TH', EIGHTH: '8TH', NINTH: '9TH', TENTH: '10TH' };
const WORD = { STREET: 'ST', AVENUE: 'AVE', ROAD: 'RD', ROADS: 'RD', DRIVE: 'DR', LANE: 'LN', SQUARE: 'SQ', TRAIL: 'TRL', CIRCLE: 'CIR', COURT: 'CT', PLACE: 'PL',
  TERRACE: 'TER', HIGHWAY: 'HWY', BOULEVARD: 'BLVD', PLAZA: 'PLZ', PARKWAY: 'PKWY', EXTENSION: 'EXT', TURNPIKE: 'TPK', TPKE: 'TPK', MOUNT: 'MT', MTN: 'MT',
  MOUNTAIN: 'MT', HEIGHTS: 'HTS', GARDENS: 'GDNS', GLEN: 'GLN', CROSSING: 'XING', LANDING: 'LNDG', GENERAL: 'GEN', COLONEL: 'COL', SAINT: 'ST',
  PIKE: 'TPK', POINT: 'PT', INDUSTRIAL: 'IND',
  NORTH: 'N', SOUTH: 'S', EAST: 'E', WEST: 'W', NORTHEAST: 'NE', NORTHWEST: 'NW', SOUTHEAST: 'SE', SOUTHWEST: 'SW' };
const TYPE = /^(ST|RD|AVE|DR|LN|CIR|CT|WAY|PL|PLZ|TER|BLVD|HWY|HYW|RT|TPK|SQ|TRL|PKWY|PARK|VILLAGE|EXT|EXN|EXD|EST|ESTATES|SHELTER|CONDO|[A-Z])$/;
const DIR = /^(N|S|E|W|NE|NW|SE|SW)$/;
const esc = s => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

// "12 W HOLLIS STREET" -> { dirs: 'W', core: 'HOLLIS', route: '' }; "5 NH ROUTE 16A" / "MA RTE 2" / "State Route 2" -> route '16A' / '2'
export function nameParts(s, state) {
  const own = new RegExp('\\b(' + STATES[state].names.map(esc).join('|') + ')\\b', 'g');
  const w = s.toUpperCase().replace(/[.']/g, '').replace(own, state).replace(/\bU S\b/g, 'US')
    .replace(new RegExp(`\\b(STATE|US|${state}) (RTE|ROUTE|RT|HWY)\\b(?= ?\\d)|\\b(RTE|ROUTE)\\b`, 'g'), 'RT')
    .split(/\s+/).filter(Boolean).map(x => NUMS[x] || WORD[x] || x);
  // House number ("12", "12A", "12-14", then a stray "-4"), but not a numbered street ("1ST AVE")
  while (/^-?\d+[A-Z]?(-\d+[A-Z]?)?$/.test(w[0] || '') && w.length > 1) w.shift();
  if (w.length > 1 && /^[A-Z]$/.test(w[0]) && !DIR.test(w[0])) w.shift(); // "12 B DIX ST": unit letter
  if (w.length > 1 && w[0] === 'OFF') w.shift(); // "OFF SUMMER ST"
  // Units left on the street: "GREEN ST 1", "WARD ST 1F", "WINTER ST APT 4", "COLUMBUS AVE BLDG 4" (not "RT 16")
  for (;;) {
    if (w.length > 2 && /^(APT|UNIT|BLDG|STE|SUITE|RM|LOT|NO)$/.test(w.at(-2))) w.splice(-2);
    else if (w.length > 1 && (/^#/.test(w.at(-1)) || (/^[A-Z]?\d+[A-Z]?$/.test(w.at(-1)) && w.at(-2) !== 'RT'))) w.pop();
    else break;
  }
  const dirs = w.filter(x => DIR.test(x)).sort().join();
  const core = w.filter(x => !DIR.test(x));
  while (core.length > 1 && TYPE.test(core.at(-1))) core.pop();
  const route = (core.join(' ').match(/\bRT ?(\d+[A-Z]?)/) || [])[1]?.replace(/[NSEW]$/, '') || '';
  return { dirs, core: core.join('').replace(/^RT\d+[A-Z]?$/, 'RT'), route };
}
const lev = (a, b) => { const d = Array.from({ length: a.length + 1 }, (_, i) => [i]); for (let j = 1; j <= b.length; j++) d[0][j] = j;
  for (let i = 1; i <= a.length; i++) for (let j = 1; j <= b.length; j++) d[i][j] = Math.min(d[i - 1][j] + 1, d[i][j - 1] + 1, d[i - 1][j - 1] + (a[i - 1] !== b[j - 1]));
  return d[a.length][b.length]; };

// Geocoders fuzzy-match a near name. Usually that fixes a typo (PROSEPECT ST -> PROSPECT ST, FIRST AVE -> 1ST AVE), but sometimes
// it is a different street (OAK HILL RD -> HILL RD, W HOLLIS ST -> E HOLLIS ST, RT 16A -> RT 16, ELM CT -> ELMO LN).
export function wrongStreet(street, matched, state) {
  const a = nameParts(street, state), b = nameParts(matched.split(',')[0], state);
  if (a.dirs !== b.dirs || a.route !== b.route) return true;
  if (a.core === b.core) return false;
  return lev(a.core, b.core) > 2 || Math.min(a.core.length, b.core.length) <= 4;
}

// Second pass after geocodeMissing, for misses and for Census hits on a wrong street: OpenStreetMap by registry town with no ZIP
// (ZIPs often cross town lines), then the village's parent town. Last resort: the street by name alone, kept (as approximate)
// only when the whole street fits in about 1 km, so a pin never lands miles down a long rural route. OSM fuzzy-matches too
// (RT 4A -> U.S. Route 4), so its road name must pass the same check. Misses are not cached (other builds read this cache
// and expect every entry to have coordinates); a wrong-street Census hit that OSM cannot place stays cached, marked
// rejected, and is not pinned. Rejected hits are retried on the next two builds, then left alone.
// townOf(row) gives the registry town (blank is allowed: the ZIP is used instead). Returns counts and masked examples.
export async function recheckGeocodes(rows, cache, state, townOf = r => r.city) {
  const S = STATES[state];
  const suspect = new Map(rows.filter(r => r.mappable && cache[geoKey(r)]?.src === 'census' && (cache[geoKey(r)].tries || 0) < 3
    && wrongStreet(r.street, cache[geoKey(r)].matched, state)).map(r => [geoKey(r), r]));
  const misses = new Map(rows.filter(r => r.mappable && !cache[geoKey(r)]).map(r => [geoKey(r), r]));
  const osm = async (street, place) => {
    const url = 'https://nominatim.openstreetmap.org/search?format=json&limit=1&addressdetails=1&countrycodes=us&street=' + encodeURIComponent(street)
      + (place.town ? '&city=' + encodeURIComponent(place.town) : '&postalcode=' + place.zip) + `&state=${state}`;
    const h = (await (await fetch(url, { headers: { 'User-Agent': 'SafeWalk/1.0 (derek.bobola@gmail.com)' } })).json())[0];
    await new Promise(res => setTimeout(res, 1100)); // Nominatim: 1 request per second
    const road = h && (h.address?.road || h.name || '');
    return h && road && inState({ lat: +h.lat, lng: +h.lon }, state) && !wrongStreet(street, road, state) ? { ...h, road } : null;
  };
  const km = bb => { const [s, n, w, e] = bb.map(Number); return Math.hypot((n - s) * 111, (e - w) * 111 * Math.cos(s * Math.PI / 180)); };
  const stats = { suspects: suspect.size, fixed: 0, rejected: 0, misses: misses.size, missesFound: 0, examples: [] };
  for (const [k, r] of [...misses, ...suspect]) {
    const town = townOf(r) || '';
    const places = [{ town, zip: r.zip }, ...(S.villages[town] ? [{ town: S.villages[town], zip: r.zip }] : [])];
    let h = null, src = 'osm-town';
    for (const p of places) if (!h) h = await osm(r.street, p);
    if (!h) {
      src = 'osm-street';
      for (const p of places) if (!h) {
        h = await osm(r.street.replace(/^\S+ /, ''), p);
        if (h && (h.class !== 'highway' || km(h.boundingbox) > 1)) h = null;
      }
    }
    const was = cache[k];
    if (h) {
      cache[k] = { lat: +h.lat, lng: +h.lon, src, matched: h.road + ', ' + (h.address?.town || h.address?.city || h.address?.village || ''),
        ...(h.class === 'highway' || src === 'osm-street' ? { approx: true } : {}) };
      if (suspect.has(k)) stats.fixed++; else stats.missesFound++;
    } else if (suspect.has(k)) {
      cache[k] = { ...was, rejected: true, tries: (was.tries || 0) + 1 };
    }
    if (suspect.has(k) && stats.examples.length < 40) {
      const mask = s => s.replace(/^\d+[A-Z]?(-\d+[A-Z]?)?\s*/, '');
      stats.examples.push(`${mask(r.street)} (${town || r.zip}): Census "${mask(was.matched.split(',')[0])}" -> ${h ? 'OSM "' + h.road + '"' + (src === 'osm-street' ? ' (approx)' : '') : 'rejected'}`);
    }
  }
  stats.rejected = new Set(rows.filter(r => r.mappable && cache[geoKey(r)]?.rejected).map(geoKey)).size;
  if (misses.size || suspect.size) writeFileSync(cacheFile(state), JSON.stringify(cache, null, 1));
  return stats;
}

// The cached geocode to pin for a row, or null (no geocode, outside the state, or rejected as a wrong street)
export const pinFor = (r, cache, state) => { const g = r.mappable && cache[geoKey(r)]; return g && !g.rejected && inState(g, state) ? g : null; };
