// Builds site/nh/data.js (statewide New Hampshire) from data/nh-state-raw.csv (run `node tools/nh-scrape.mjs --state` first).
// Geocodes new addresses and writes only data.js; the app files in site/nh are maintained separately.
import { readFileSync, writeFileSync, mkdirSync, statSync } from 'node:fs';
import { geoKey } from './registry.mjs';
import { geocodeMissing, cacheFile } from './geocoder.mjs';
import { REGIONS } from './regions.mjs';

const AS_OF = '2026-10-23'; // update on each registry refresh
const SUFFIX = { STREET: 'ST', AVENUE: 'AVE', ROAD: 'RD', DRIVE: 'DR', LANE: 'LN', SQUARE: 'SQ', TRAIL: 'TRL', CIRCLE: 'CIR', COURT: 'CT', PLACE: 'PL', TERRACE: 'TER', HIGHWAY: 'HWY', BOULEVARD: 'BLVD' };
// "12 ROUTE 101" / "12 HWY 1": the number after these is the road, not a unit ("DANIEL WEBSTER HWY 1B" is a unit)
const isRoute = words => /^(ROUTE|RT|RTE|US|NH)$/.test(words.at(-2)) || (words.at(-2) === 'HWY' && words.length === 3);
const UNIT = /^(APT|UNIT|LOT|STE|SUITE|RM|ROOM|TRLR|BLDG|BOX|#)$/; // "BOX 3" after a house address is a mail slot, not a PO box
const BOX = { latMin: 42.69, latMax: 45.31, lngMin: -72.56, lngMax: -70.60 };
const title = s => s.toLowerCase().replace(/\b[a-z]/g, c => c.toUpperCase());

function splitCsv(line) {
  const out = []; let cur = '', q = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (ch === '"') { if (q && line[i + 1] === '"') { cur += '"'; i++; } else q = !q; }
    else if (ch === ',' && !q) { out.push(cur); cur = ''; }
    else cur += ch;
  }
  out.push(cur);
  return out;
}

// "23 TEMPLE ST 410 NASHUA NH, 03060" with town NASHUA -> { street: '23 TEMPLE ST', city: 'NASHUA', zip: '03060', mappable: true }
// The town comes from the registry's city column, so multi-word towns (NEW BOSTON, NORTH HAMPTON) are never guessed.
function parse(address, town) {
  const m = address.match(/^(.*?)\s*\bNH,?\s*(\d{5})?(?:-\d{4})?$/);
  if (!m) return null; // out of state
  let rest = m[1].trim(), postal = town;
  if (rest.endsWith(' ' + town) || rest === town) {
    rest = rest.slice(0, -town.length).trim();
    // "9 MAIN ST WEST LEBANON" in Lebanon, "NORTH CONWAY" in Conway: the direction belongs to the village name
    const v = rest.match(/^(.*\b(?:[A-Z]+|\d\w*)) (NORTH|SOUTH|EAST|WEST|CENTER|CENTRE)$/);
    if (v && (Object.values(SUFFIX).includes(v[1].split(' ').at(-1)) || /\d/.test(v[1].split(' ').at(-1)))) { rest = v[1]; postal = v[2] + ' ' + town; }
  } else {
    // Postal village that differs from the town (WEST LEBANON in Lebanon, etc.): drop the trailing words that are not the street
    const w = rest.split(' ');
    const sfx = new Set([...Object.values(SUFFIX), 'WAY', 'PKWY', 'EXT', 'PIKE', 'ROW', 'HL', 'PT', 'XING']);
    let cut = w.length;
    for (let i = w.length - 1; i > 0; i--) if (sfx.has(w[i]) || /\d/.test(w[i])) { cut = i + 1; break; }
    postal = w.slice(cut).join(' ') || town;
    rest = w.slice(0, cut).join(' ');
  }
  // "12-1/2 PLEASANT ST" is pinned on number 12
  const words = rest.split(' ').filter(w => w && !/^1\/2/.test(w)).map((w, i) => i ? SUFFIX[w] || w : w.replace(/-1\/2$/, ''));
  // Drop unit numbers after the street name: "410", "E103", "R11", "2ND FL", "2ND FLOOR", "APT 3", "LOT 12", "BOX 3"
  for (;;) {
    if (words.length > 2 && words.at(-2) && UNIT.test(words.at(-2))) { words.splice(-2); continue; }
    if (words.length > 2 && /^#/.test(words.at(-1))) { words.pop(); continue; }
    if (words.length > 2 && (/\d/.test(words.at(-1)) || /^(FL|FLOOR)$/.test(words.at(-1))) && !isRoute(words)) { words.pop(); continue; }
    break;
  }
  const street = words.join(' ');
  // Homeless, PO boxes, motels with no number and anything else not starting with a house number cannot be pinned
  const mappable = /^\d+[A-Z]?(-\d+[A-Z]?)?$/.test(words[0] || '') && !/^0+$/.test(words[0]) && words.length > 1
    && !/\b(HOMELESS|TRANSIENT|P ?O BOX)\b/.test(street);
  return { street: mappable ? street : '', city: postal, zip: m[2] || '', mappable };
}

const lines = readFileSync('data/nh-state-raw.csv', 'utf8').trim().split(/\r?\n/).slice(1);
const byId = new Map();
let outOfState = 0, rawRows = 0;
const oddPostal = new Map();
for (const l of lines) {
  const [county, id, address, city, state] = splitCsv(l);
  rawRows++;
  if (state && state !== 'NH') { outOfState++; continue; }
  const a = parse(address, city);
  if (!a) { outOfState++; continue; }
  if (a.city !== city) oddPostal.set(a.city + ' in ' + city, (oddPostal.get(a.city + ' in ' + city) || 0) + 1);
  if (!byId.has(id)) byId.set(id, []);
  byId.get(id).push({ town: city, county, id, ...a });
}
// A person can be listed in more than one county (each is a registered address). Pin every mappable address;
// a homeless or no-number row is dropped when the same person also has a mappable one.
const people = [...byId.values()].map(rs => rs.some(r => r.mappable) ? rs.filter(r => r.mappable) : [rs[0]]);
const rows = people.flat();
const countyOf = {};
for (const rs of byId.values()) for (const c of new Set(rs.map(r => r.county))) countyOf[c] = (countyOf[c] || 0) + 1; // people listed in each county

// Geocodes outside New Hampshire (a Census or OSM mis-hit) are not pinned
const inBox = g => g.lat >= BOX.latMin && g.lat <= BOX.latMax && g.lng >= BOX.lngMin && g.lng <= BOX.lngMax;
const cache = await geocodeMissing(rows, 'NH');
// Census fuzzy-matches a near name, which is usually a typo fix (PROSEPECT ST -> PROSPECT ST, FIRST AVE -> 1ST AVE) but
// sometimes a different street (OAK HILL RD -> HILL RD, W HOLLIS ST -> E HOLLIS ST, RT 16A -> RT 16). Those get re-done below.
const NUMS = { FIRST: '1ST', SECOND: '2ND', THIRD: '3RD', FOURTH: '4TH', FIFTH: '5TH', SIXTH: '6TH', SEVENTH: '7TH', EIGHTH: '8TH', NINTH: '9TH', TENTH: '10TH' };
const WORD = { COURT: 'CT', LANE: 'LN', TERRACE: 'TER', MOUNT: 'MT', MTN: 'MT', MOUNTAIN: 'MT', HEIGHTS: 'HTS', TURNPIKE: 'TPK', TPKE: 'TPK', STREET: 'ST', ROAD: 'RD', ROADS: 'RD',
  PARKWAY: 'PKWY', EXTENSION: 'EXT', GARDENS: 'GDNS', GLEN: 'GLN', CROSSING: 'XING', LANDING: 'LNDG', GENERAL: 'GEN', COLONEL: 'COL', SAINT: 'ST', NORTH: 'N', SOUTH: 'S', EAST: 'E', WEST: 'W', NORTHEAST: 'NE', NORTHWEST: 'NW', SOUTHEAST: 'SE', SOUTHWEST: 'SW' };
const TYPE = /^(ST|RD|AVE|DR|LN|CIR|CT|WAY|PL|TER|BLVD|HWY|HYW|RT|TPK|SQ|TRL|PKWY|PARK|VILLAGE|EXT|EXN|EXD|EST|ESTATES|SHELTER|CONDO|[A-Z])$/;
function nameParts(s) {
  const w = s.toUpperCase().replace(/[.']/g, '').replace(/\bNEW HAMPSHIRE\b|\bN H\b/g, 'NH').replace(/\bU S\b/g, 'US').replace(/\b(STATE|US|NH) (RTE|ROUTE|RT|HWY)\b|\b(RTE|ROUTE)\b/g, 'RT')
    .split(/\s+/).filter(Boolean).map(x => NUMS[x] || WORD[x] || SUFFIX[x] || x);
  if (/^\d/.test(w[0] || '')) w.shift(); // house number
  if (w.length > 1 && /^[A-Z]$/.test(w[0]) && !/^[NSEW]$/.test(w[0])) w.shift(); // "12 B DIX ST": unit letter
  const dirs = w.filter(x => /^(N|S|E|W|NE|NW|SE|SW)$/.test(x)).sort().join();
  let core = w.filter(x => !/^(N|S|E|W|NE|NW|SE|SW)$/.test(x));
  while (core.length > 1 && TYPE.test(core.at(-1))) core.pop();
  const route = (core.join(' ').match(/\bRT ?(\d+[A-Z]?)/) || [])[1]?.replace(/[NSEW]$/, '') || '';
  return { dirs, core: core.join('').replace(/^RT\d+[A-Z]?$/, 'RT'), route };
}
const lev = (a, b) => { const d = Array.from({ length: a.length + 1 }, (_, i) => [i]); for (let j = 1; j <= b.length; j++) d[0][j] = j;
  for (let i = 1; i <= a.length; i++) for (let j = 1; j <= b.length; j++) d[i][j] = Math.min(d[i - 1][j] + 1, d[i][j - 1] + 1, d[i - 1][j - 1] + (a[i - 1] !== b[j - 1]));
  return d[a.length][b.length]; };
function wrongStreet(street, matched) {
  const a = nameParts(street), b = nameParts(matched.split(',')[0]);
  if (a.dirs !== b.dirs || a.route !== b.route) return true;
  if (a.core === b.core) return false;
  return lev(a.core, b.core) > 2 || Math.min(a.core.length, b.core.length) <= 4;
}
const suspect = new Map(rows.filter(r => r.mappable && cache[geoKey(r)]?.src === 'census' && wrongStreet(r.street, cache[geoKey(r)].matched)).map(r => [geoKey(r), r]));

// Second try, for misses and suspect Census hits: OpenStreetMap by registry town with no ZIP (rural ZIPs often cross town
// lines). Last resort: the street by name alone, kept (as approximate) only when the whole street fits in about 1 km, so a pin
// never lands miles down a long rural route. Misses are not cached, so each build retries them (about a minute); a suspect
// Census hit that OSM cannot place is kept in the cache marked rejected, is not pinned, and is retried on the next build.
const retry = new Map([...rows.filter(r => r.mappable && !cache[geoKey(r)]).map(r => [geoKey(r), r]), ...suspect]);
// OSM fuzzy-matches too (RT 4A -> U.S. Route 4, PINE ST -> Union Street), so its road name must pass the same check
const osm = async (street, town) => {
  const h = (await (await fetch('https://nominatim.openstreetmap.org/search?format=json&limit=1&addressdetails=1&countrycodes=us&street='
    + encodeURIComponent(street) + '&city=' + encodeURIComponent(town) + '&state=NH', { headers: { 'User-Agent': 'SafeWalk/1.0 (derek.bobola@gmail.com)' } })).json())[0];
  await new Promise(res => setTimeout(res, 1100)); // Nominatim: 1 request per second
  const road = h && (h.address?.road || h.name || '');
  return h && road && !wrongStreet(street, road) ? { ...h, road } : null;
};
const km = bb => { const [s, n, w, e] = bb.map(Number); return Math.hypot((n - s) * 111, (e - w) * 111 * Math.cos(s * Math.PI / 180)); };
let retried = 0;
for (const [k, r] of retry) {
  let h = await osm(r.street, r.town), src = 'osm-town';
  if (!h) {
    h = await osm(r.street.replace(/^\S+ /, ''), r.town);
    src = 'osm-street';
    if (h && (h.class !== 'highway' || km(h.boundingbox) > 1)) h = null;
  }
  if (h && inBox({ lat: +h.lat, lng: +h.lon })) {
    cache[k] = { lat: +h.lat, lng: +h.lon, src, matched: h.road + ', ' + (h.address?.town || h.address?.city || h.address?.village || ''), ...(h.class === 'highway' || src === 'osm-street' ? { approx: true } : {}) };
    retried++;
  } else if (suspect.has(k)) cache[k] = { ...cache[k], rejected: true };
}
if (retry.size) { writeFileSync(cacheFile('NH'), JSON.stringify(cache, null, 1)); console.log(`town retry: ${retried} of ${retry.size} found (${suspect.size} were suspect Census hits)`); }
const locs = new Map();
const unmapped = [];
const perTown = {};
const outside = [];
for (const rs of people) {
  let pinned = false;
  for (const r of rs) {
    const town = title(r.town);
    perTown[town] = (perTown[town] || 0) + 1;
    const g = r.mappable && !cache[geoKey(r)]?.rejected && cache[geoKey(r)];
    if (g && !inBox(g)) outside.push(geoKey(r).replace(/^\d+/, '#'));
    if (!g || !inBox(g)) continue;
    const key = geoKey(r);
    if (!locs.has(key)) locs.set(key, { street: r.street, city: r.town, zip: r.zip, lat: g.lat, lng: g.lng, ...(g.approx ? { approx: true } : {}), entries: [] });
    if (!locs.get(key).entries.some(e => e.link === r.id)) locs.get(key).entries.push({ type: 'LISTED', link: r.id });
    pinned = true;
  }
  if (!pinned) unmapped.push({ town: title(rs[0].town), type: 'LISTED', link: rs[0].id });
}

const region = REGIONS.nh;
const towns = Object.keys(perTown).sort();
const out = { asOf: AS_OF, source: region.registryHome, region, towns, perTown, total: people.length, locations: [...locs.values()], unmapped };
mkdirSync('site/nh', { recursive: true });
writeFileSync('site/nh/data.js', '// Generated by tools/build-nh.mjs. Do not edit by hand.\nwindow.SAFEWALK_DATA = ' + JSON.stringify(out) + ';\n');

// Sanity report (addresses masked, no names exist in the input)
const used = [...new Set(rows.filter(r => r.mappable).map(geoKey))].map(k => cache[k]).filter(Boolean);
const src = {};
for (const g of used) { const s = (g.src || '?') + (g.approx ? '+approx' : '') + (g.rejected ? ' (rejected: wrong street)' : ''); src[s] = (src[s] || 0) + 1; }
console.log(`raw rows ${rawRows} | listings (people) ${people.length} | addresses kept ${rows.length} | locations ${locs.size} | people pinned ${people.length - unmapped.length} | unmapped ${unmapped.length} | out of state rows ${outOfState} | people with 2+ pins ${people.filter(rs => rs.length > 1).length}`);
console.log('unmapped that had a street address but no usable geocode:', unmapped.length - people.filter(rs => !rs[0].mappable).length);
console.log('geocode sources (unique addresses):', src);
const zipOff = [...new Set(rows.filter(r => r.mappable).map(geoKey))].filter(k => cache[k]?.src === 'census' && !cache[k].matched.endsWith(k.split('|')[1]));
console.log('census hits whose matched ZIP differs from the registry ZIP:', zipOff.length, zipOff.slice(0, 15).map(k => k.replace(/^\d+/, '#') + ' -> ' + cache[k].matched.replace(/^\d+/, '#')));
console.log('outside NH box (dropped to unmapped):', outside.length, outside);
console.log('per county:', countyOf);
console.log('towns:', towns.length, '| Nashua:', perTown.Nashua);
console.log('postal city differs from town:', Object.fromEntries([...oddPostal].sort((a, b) => b[1] - a[1])));
console.log('top locations:', [...locs.values()].sort((a, b) => b.entries.length - a.entries.length).slice(0, 10)
  .map(l => `${l.entries.length} ${l.street.replace(/^\d+[A-Z]?(-\d+)?/, '#')}, ${title(l.city)}${l.approx ? ' (approx)' : ''}`));
console.log('data.js bytes:', statSync('site/nh/data.js').size);
