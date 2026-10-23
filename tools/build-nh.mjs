// Builds site/nh/data.js (statewide New Hampshire) from data/nh-state-raw.csv (run `node tools/nh-scrape.mjs --state` first).
// Geocodes new addresses and writes only data.js; the app files in site/nh are maintained separately.
import { readFileSync, writeFileSync, mkdirSync, statSync } from 'node:fs';
import { geoKey } from './registry.mjs';
import { geocodeMissing, recheckGeocodes, pinFor } from './geocoder.mjs';
import { REGIONS } from './regions.mjs';

const AS_OF = '2026-10-23'; // update on each registry refresh
const SUFFIX = { STREET: 'ST', AVENUE: 'AVE', ROAD: 'RD', DRIVE: 'DR', LANE: 'LN', SQUARE: 'SQ', TRAIL: 'TRL', CIRCLE: 'CIR', COURT: 'CT', PLACE: 'PL', TERRACE: 'TER', HIGHWAY: 'HWY', BOULEVARD: 'BLVD' };
// "12 ROUTE 101" / "12 HWY 1": the number after these is the road, not a unit ("DANIEL WEBSTER HWY 1B" is a unit)
const isRoute = words => /^(ROUTE|RT|RTE|US|NH)$/.test(words.at(-2)) || (words.at(-2) === 'HWY' && words.length === 3);
const UNIT = /^(APT|UNIT|LOT|STE|SUITE|RM|ROOM|TRLR|BLDG|BOX|#)$/; // "BOX 3" after a house address is a mail slot, not a PO box
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

const cache = await geocodeMissing(rows, 'NH');
// Misses and wrong-street Census hits get a second try from OpenStreetMap; see recheckGeocodes in geocoder.mjs
const fix = await recheckGeocodes(rows, cache, 'NH', r => r.town);
console.log('recheck:', JSON.stringify({ ...fix, examples: undefined }));
const locs = new Map();
const unmapped = [];
const perTown = {};
const outside = [];
for (const rs of people) {
  let pinned = false;
  for (const r of rs) {
    const town = title(r.town);
    perTown[town] = (perTown[town] || 0) + 1;
    const g = pinFor(r, cache, 'NH');
    const c = r.mappable && cache[geoKey(r)];
    if (c && !c.rejected && !g) outside.push(geoKey(r).replace(/^\d+/, '#')); // cached but outside New Hampshire
    if (!g) continue;
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
