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
  PIKE: 'TPK', POINT: 'PT', INDUSTRIAL: 'IND', PKY: 'PKWY', BUSINESS: 'BUS', CENTER: 'CTR', CENTRE: 'CTR',
  STREERT: 'ST', STRET: 'ST', SREET: 'ST', STEET: 'ST', STRRET: 'ST',
  NORTH: 'N', SOUTH: 'S', EAST: 'E', WEST: 'W', NORTHEAST: 'NE', NORTHWEST: 'NW', SOUTHEAST: 'SE', SOUTHWEST: 'SW' };
const TYPE = /^(ST|RD|AVE|DR|LN|CIR|CT|WAY|PL|PLZ|TER|BLVD|HWY|HYW|RT|TPK|SQ|TRL|PKWY|PARK|VILLAGE|EXT|EXN|EXD|EST|ESTATES|SHELTER|CONDO|[A-Z])$/;
const DIR = /^(N|S|E|W|NE|NW|SE|SW)$/;
const esc = s => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

// "12 W HOLLIS STREET" -> { dirs: 'W', core: 'HOLLIS', route: '' }; "5 NH ROUTE 16A" / "MA RTE 2" / "State Route 2" -> route '16A' / '2'
export function nameParts(s, state) {
  const own = new RegExp('\\b(' + STATES[state].names.map(esc).join('|') + ')\\b', 'g');
  const w = s.toUpperCase().replace(/[.']/g, '').replace(own, state).replace(/\bU S\b/g, 'US')
    .replace(new RegExp(`\\b(STATE|US|${state}) (RTE|ROUTE|RT|HWY)\\b(?= ?\\d)|\\b(RTE|ROUTE)\\b`, 'g'), 'RT')
    .replace(new RegExp(`\\b(US|${state}) (?=\\d)`, 'g'), 'RT ') // OSM refs: "NH 16", "US 3"
    .split(/\s+/).filter(Boolean).map(x => NUMS[x] || WORD[x] || x);
  // House number ("12", "12A", "12-14", then a stray "-4"), but not a numbered street ("1ST AVE")
  while ((/^-?\d+[A-Z]?(-[A-Z0-9]+)?$/.test(w[0] || '') || /^-[A-Z0-9]+$/.test(w[0] || '')) && w.length > 1) w.shift();
  if (w.length > 1 && /^[A-Z]$/.test(w[0]) && !DIR.test(w[0])) w.shift(); // "12 B DIX ST": unit letter
  if (w.length > 1 && w[0] === 'OFF') w.shift(); // "OFF SUMMER ST"
  // Units left on the street: "GREEN ST 1", "WARD ST 1F", "WINTER ST APT 4", "COLUMBUS AVE BLDG 4" (not "RT 16")
  for (;;) {
    if (w.length > 2 && /^(APT|UNIT|BLDG|STE|SUITE|RM|LOT|NO)$/.test(w.at(-2))) w.splice(-2);
    else if (w.length > 1 && (/^#/.test(w.at(-1)) || /^\d+(FL|ST|ND|RD|TH)?FL(OOR)?$/.test(w.at(-1)) || (/^[A-Z]?\d+[A-Z]?$/.test(w.at(-1)) && w.at(-2) !== 'RT'))) w.pop();
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
// A near spelling of the same street (DEAN ST / DEANE ST): same direction and route, at most two letters apart
const nearName = (street, other, state) => {
  const a = nameParts(street, state), b = nameParts(other.split(',')[0], state);
  return a.dirs === b.dirs && a.route === b.route && lev(a.core, b.core) <= 2;
};

// "12 MAIN ST APT 4" -> "MAIN ST"; "5 RT 16" -> "RT 16" (the number after a route word is the road)
export function streetName(street) {
  const w = street.toUpperCase().split(/\s+/).filter(x => x && !/^\d*1\/2$/.test(x));
  while (w.length > 1 && /^-?\d+[A-Z]?(-\d+[A-Z]?)?$/.test(w[0])) w.shift();
  for (;;) {
    if (w.length > 2 && /^(APT|UNIT|BLDG|STE|SUITE|RM|LOT|NO|FL)$/.test(w.at(-2))) w.splice(-2);
    else if (w.length > 1 && (/^#/.test(w.at(-1)) || (/^[A-Z]?\d+[A-Z]?$/.test(w.at(-1)) && !/^(RT|RTE|ROUTE|HWY|US|NH|MA)$/.test(w.at(-2))))) w.pop();
    else break;
  }
  return w.join(' ');
}

// Second pass after geocodeMissing, for misses and for Census hits on a wrong street: OpenStreetMap by registry town with no ZIP
// (ZIPs often cross town lines), then the village's parent town. Last resort: the named street itself, with no house number
// (a pin somewhere on the right street, marked place 'street' and approximate). OSM fuzzy-matches too (RT 4A -> U.S. Route 4),
// so its road name must pass the same check. Misses are not cached (other builds read this cache and expect every entry to
// have coordinates); a wrong-street Census hit that OSM cannot place stays cached, marked rejected, and the build places that
// listing at its town instead. Rejected hits are retried on the next two builds, then left alone.
// townOf(row) gives the registry town (blank is allowed: the ZIP is used instead). Returns counts and masked examples.
export async function recheckGeocodes(rows, cache, state, townOf = r => r.city) {
  const S = STATES[state];
  // A hit rejected under an older, stricter check that now passes (CONGRESS ST 3FL -> CONGRESS ST) is good again
  for (const r of rows) {
    const g = r.mappable && cache[geoKey(r)];
    if (g?.rejected && g.src === 'census' && !wrongStreet(r.street, g.matched, state)) { delete g.rejected; delete g.tries; }
  }
  const suspect = new Map(rows.filter(r => r.mappable && cache[geoKey(r)]?.src === 'census' && !cache[geoKey(r)].confirmed && (cache[geoKey(r)].tries || 0) < 3
    && wrongStreet(r.street, cache[geoKey(r)].matched, state)).map(r => [geoKey(r), r]));
  const misses = new Map(rows.filter(r => r.mappable && !cache[geoKey(r)]).map(r => [geoKey(r), r]));
  // censusName: for a suspect, the street Census matched. When OSM's road agrees with Census and is a near spelling of the
  // registry's, the registry has the typo (ALLY ST -> Alley Street) and the street is right.
  const osm = async (street, place, censusName) => {
    const url = 'https://nominatim.openstreetmap.org/search?format=json&limit=1&addressdetails=1&namedetails=1&countrycodes=us&street=' + encodeURIComponent(street)
      + (place.town ? '&city=' + encodeURIComponent(place.town) : '&postalcode=' + place.zip) + `&state=${state}`;
    const h = (await (await fetch(url, { headers: { 'User-Agent': 'SafeWalk/1.0 (derek.bobola@gmail.com)' } })).json())[0];
    await new Promise(res => setTimeout(res, 1100)); // Nominatim: 1 request per second
    if (!h || !inState({ lat: +h.lat, lng: +h.lon }, state)) return null;
    // Any of the road's names will do, including its route numbers ("White Mountain Highway" carries ref "NH 16;NH 25")
    const names = [h.address?.road, h.name, ...Object.values(h.namedetails || {}).flatMap(v => String(v).split(';'))].filter(Boolean);
    const road = names.find(n => !wrongStreet(street, n, state))
      || (censusName && names.find(n => nearName(street, n, state) && !wrongStreet(censusName, n, state)));
    return road ? { ...h, road } : null;
  };
  const stats = { suspects: suspect.size, fixed: 0, rejected: 0, misses: misses.size, missesFound: 0, examples: [] };
  for (const [k, r] of [...misses, ...suspect]) {
    const town = townOf(r) || '';
    const places = [{ town, zip: r.zip }, ...(S.villages[town] ? [{ town: S.villages[town], zip: r.zip }] : [])];
    let h = null, src = 'osm-town';
    const censusName = suspect.has(k) ? cache[k].matched.split(',')[0] : null;
    for (const p of places) if (!h) h = await osm(r.street, p, censusName);
    if (!h) {
      src = 'osm-street';
      // A route by any spelling ("RTE 44", "MA RTE 132", "MASSACHUSETTS 128", "NH RT 118") is also tried as OSM names it
      const name = streetName(r.street), n = (name.match(/^(?:(?:US|NH|MA|MASSACHUSETTS|STATE)\s+)?(?:RT|RTE|ROUTE|HWY)?\s*(\d+[A-Z]?)$/) || [])[1];
      const names = [...new Set([name, ...(n ? [`${state} ${n}`, `Route ${n}`, `State Route ${n}`] : [])])];
      for (const p of places) for (const nm of names) if (!h) {
        h = await osm(nm, p, censusName);
        if (h && h.class !== 'highway') h = null;
      }
    }
    const was = cache[k];
    // OSM has neither spelling at a house, but Census matched a near spelling (DEAN ST -> DEANE ST): when OSM confirms that
    // street exists in the town, the Census building is the registry's address with a typo, so it stands
    if (!h && censusName && nearName(r.street, censusName, state)) {
      let ok = null;
      for (const p of places) if (!ok) ok = await osm(streetName(censusName), p);
      if (ok) {
        cache[k] = { ...was, confirmed: true };
        delete cache[k].rejected;
        stats.fixed++;
        if (stats.examples.length < 40) stats.examples.push(`${streetName(r.street)} (${town || r.zip}): Census "${streetName(censusName)}" kept (near spelling, street confirmed by OSM)`);
        continue;
      }
    }
    if (h) {
      cache[k] = { lat: +h.lat, lng: +h.lon, src, matched: h.road + ', ' + (h.address?.town || h.address?.city || h.address?.village || ''),
        ...(h.class === 'highway' || src === 'osm-street' ? { approx: true } : {}), ...(src === 'osm-street' ? { place: 'street' } : {}) };
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
// How exact a pin is: a building, or only the right street (an OSM road match with no house)
export const placeOf = g => g.place === 'street' || g.approx ? 'street' : 'building';

// Center of a town (or village, or Boston neighborhood) or county, for listings with no usable street. Cached in the state's
// geocache under "TOWN|<NAME>" / "COUNTY|<NAME>". A village OSM does not know falls back to its parent town. Returns null
// when OSM has nothing; the caller then goes one level up (town -> county -> state).
export async function placeCenter(kind, name, state, cache) {
  const key = `${kind}|${name.toUpperCase()}`;
  if (cache[key]) return cache[key];
  const S = STATES[state];
  const q = kind === 'COUNTY' ? `&county=${encodeURIComponent(name + ' County')}` : `&city=${encodeURIComponent(name)}`;
  const hits = await (await fetch(`https://nominatim.openstreetmap.org/search?format=json&limit=3&countrycodes=us&state=${state}` + q,
    { headers: { 'User-Agent': 'SafeWalk/1.0 (derek.bobola@gmail.com)' } })).json();
  await new Promise(res => setTimeout(res, 1100)); // Nominatim: 1 request per second
  const h = hits.find(x => /^(place|boundary)$/.test(x.class) && inState({ lat: +x.lat, lng: +x.lon }, state));
  let g = h ? { lat: +h.lat, lng: +h.lon, src: 'osm-place', matched: h.display_name.split(',').slice(0, 2).join(','), approx: true, place: 'town' } : null;
  if (!g && kind === 'TOWN' && S.villages[name.toUpperCase()]) {
    const parent = await placeCenter('TOWN', S.villages[name.toUpperCase()], state, cache);
    if (parent) g = { ...parent, matched: parent.matched + ' (parent town)' };
  }
  if (g) { cache[key] = g; writeFileSync(cacheFile(state), JSON.stringify(cache, null, 1)); }
  return g;
}

// Puts every row on the map at the most exact place we can honestly give: its building, else somewhere on its named street,
// else the center of its town (then county, then state). Nothing is left out.
// opts: townOf(r) / countyOf(r) give registry names, entryOf(r) builds the entry, mergeTwins joins one building listed under
// two ZIPs, stateCenter is [lat, lng]. Town-level entries carry addr: the registry's own address text (r.text).
// Returns { locations, placement: { building, street, town }, fallbacks } with every row in exactly one entry.
const titleCase = s => s.toLowerCase().replace(/\b[a-z]/g, c => c.toUpperCase());
export async function placeAll(rows, cache, state, { townOf, countyOf, entryOf, mergeTwins = false, stateCenter }) {
  const locs = new Map(), byStreet = new Map();
  const placement = { building: 0, street: 0, town: 0 }, fallbacks = { county: [], state: 0 };
  for (const r of rows) {
    const g = pinFor(r, cache, state);
    if (g) {
      const place = placeOf(g);
      let key = geoKey(r);
      if (mergeTwins) {
        const twin = (byStreet.get(r.street) || []).map(k => locs.get(k)).find(l => Math.hypot((l.lat - g.lat) * 111, (l.lng - g.lng) * 82) < 0.1);
        if (twin) key = twin.key;
      }
      if (!locs.has(key)) {
        locs.set(key, { key, street: r.street, city: townOf(r), zip: r.zip, lat: g.lat, lng: g.lng, ...(place === 'street' ? { approx: true, place } : {}), entries: [] });
        byStreet.set(r.street, [...(byStreet.get(r.street) || []), key]);
      }
      locs.get(key).entries.push(entryOf(r));
      placement[place]++;
      continue;
    }
    const town = townOf(r), county = countyOf(r);
    let c = town ? await placeCenter('TOWN', town, state, cache) : null, key = 'TOWN|' + town, city = town;
    if (!c && county) {
      c = await placeCenter('COUNTY', county, state, cache); key = 'COUNTY|' + county.toUpperCase(); city = titleCase(county) + ' County';
      fallbacks.county.push(town || '(no town)');
    }
    if (!c) { c = { lat: stateCenter[0], lng: stateCenter[1] }; key = 'STATE'; city = city || state; fallbacks.state++; }
    if (!locs.has(key)) locs.set(key, { key, street: '', city, zip: '', lat: c.lat, lng: c.lng, approx: true, place: 'town', entries: [] });
    locs.get(key).entries.push({ ...entryOf(r), addr: r.text || (r.type === 'HOMELESS' ? 'HOMELESS' : 'NO STREET GIVEN') });
    placement.town++;
  }
  const locations = [...locs.values()].map(({ key, ...l }) => l);
  const placed = locations.reduce((n, l) => n + l.entries.length, 0);
  if (placed !== rows.length) throw new Error(`placement lost listings: ${rows.length} rows but ${placed} entries`);
  return { locations, placement, fallbacks };
}
