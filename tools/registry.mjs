// Shared parsing for data/sorb-raw.csv (exported from the SORB city/town search; names never stored)
import { readFileSync } from 'node:fs';

export const TOWNS = { LO: 'Lowell', CH: 'Chelmsford', DR: 'Dracut', TE: 'Tewksbury', BI: 'Billerica', TY: 'Tyngsborough', WE: 'Westford' };

const SUFFIX = { STREET: 'ST', AVENUE: 'AVE', ROAD: 'RD', DRIVE: 'DR', LANE: 'LN', PLACE: 'PL', COURT: 'CT', SQUARE: 'SQ', PLAZA: 'PLZ', BOULEVARD: 'BLVD', TERRACE: 'TER' };

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

// "365 EAST ST, BLDG Saunders Building, TEWKSBURY 01876" -> { street: '365 EAST ST', city: 'TEWKSBURY', zip: '01876' }
export function parseAddress(raw) {
  const mappable = !/\(NM\)/.test(raw);
  const parts = raw.replace(/\s*\(NM\)/, '').split(',').map(s => s.trim()).filter(Boolean);
  const last = parts[parts.length - 1] || '';
  const m = last.match(/^(.*?)\s*(\d{5})?$/);
  const city = (m[1] || '').replace(/^MA$/, '').trim();
  const zip = m[2] || '';
  const first = parts[0] || '';
  const street = parts.length > 1 && /^\d/.test(first)
    ? first.toUpperCase().replace(/\s+/g, ' ').split(' ').map(w => SUFFIX[w] || w).join(' ')
    : '';
  return { street, city: city || 'LOWELL', zip, mappable: mappable && !!street };
}

export function readRegistry(file = 'data/sorb-raw.csv') {
  const lines = readFileSync(file, 'utf8').trim().split(/\r?\n/).slice(1);
  return lines.map((l, i) => {
    const [town, level, , type, address, , dupe] = splitCsv(l);
    return { idx: i + 1, town, level: +level, type, dupe: dupe === '1', ...parseAddress(address) };
  });
}

// Geocode key: the same building regardless of "North Chelmsford" vs "Chelmsford" spelling
export const geoKey = r => `${r.street}|${r.zip}`;
