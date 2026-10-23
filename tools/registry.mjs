// Shared MA registry address parsing (names never stored)
const SUFFIX = { STREET: 'ST', AVENUE: 'AVE', ROAD: 'RD', DRIVE: 'DR', LANE: 'LN', PLACE: 'PL', COURT: 'CT', SQUARE: 'SQ', PLAZA: 'PLZ', BOULEVARD: 'BLVD', TERRACE: 'TER' };

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
    ? first.toUpperCase().replace(/\s+/g, ' ').split(' ').map((w, i, a) => (i === a.length - 1 && SUFFIX[w]) || w).join(' ') // last word only: COURT ST stays COURT ST
    : '';
  return { street, city, zip, mappable: mappable && !!street };
}

// Geocode key: the same building regardless of "North Chelmsford" vs "Chelmsford" spelling
export const geoKey = r => `${r.street}|${r.zip}`;
