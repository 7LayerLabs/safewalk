// data/ma-raw.csv = the county pull (data/ma-raw-counties.csv) plus every listing only the town pull (data/ma-towns-raw.csv) found.
// The county search skips addresses the registry could not map, so the town pull is what makes the list complete.
import { readFileSync, writeFileSync } from 'node:fs';

function splitCsv(line) {
  const out = []; let cur = '', q = false;
  for (const ch of line) {
    if (ch === '"') q = !q;
    else if (ch === ',' && !q) { out.push(cur); cur = ''; }
    else cur += ch;
  }
  out.push(cur);
  return out;
}
const lines = f => readFileSync(f, 'utf8').trim().split(/\r?\n/);
const norm = a => a.toUpperCase().replace(/,\s*MA\b\s*(\d{5})?(-\d{4})?/, (m, z) => z ? ' ' + z : '').replace(/\s+/g, ' ').trim();
const q = s => '"' + String(s).replace(/"/g, '""') + '"';

const county = lines('data/ma-raw-counties.csv');
const keys = new Set(county.slice(1).map(splitCsv).map(r => `${r[4]}|${r[2]}|${norm(r[3])}`));
const people = new Set(county.slice(1).map(splitCsv).map(r => r[4]));
const add = [];
let newPeople = new Set();
for (const [, level, type, addr, link] of lines('data/ma-towns-raw.csv').slice(1).map(splitCsv)) {
  const k = `${link}|${type}|${norm(addr)}`;
  if (keys.has(k)) continue;
  keys.add(k);
  if (!people.has(link)) newPeople.add(link);
  add.push(['', level, type, q(addr), link].join(','));
}
writeFileSync('data/ma-raw.csv', county.join('\n') + '\n' + add.join('\n') + '\n');
console.log(`county rows ${county.length - 1} + town-only rows ${add.length} (${newPeople.size} people the county search missed) = ${county.length - 1 + add.length}`);
