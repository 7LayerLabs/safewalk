// Shared registry address parsing (names never stored)
const SUFFIX = { STREET: 'ST', AVENUE: 'AVE', ROAD: 'RD', DRIVE: 'DR', LANE: 'LN', PLACE: 'PL', COURT: 'CT', SQUARE: 'SQ', PLAZA: 'PLZ', BOULEVARD: 'BLVD', TERRACE: 'TER' };
const WORD_NUM = { ONE: '1', TWO: '2', THREE: '3', FOUR: '4', FIVE: '5', SIX: '6', SEVEN: '7', EIGHT: '8', NINE: '9', TEN: '10' };
// Street text that names no real place: "HOMELESS ST", "Homless", "anwhere"
const NO_PLACE = /\b(HOMELESS|HOMLESS|TRANSIENT|UNKNOWN|ANYWHERE|ANWHERE)\b/;

// MA SORB address. "365 EAST ST, BLDG Saunders Building, TEWKSBURY 01876" -> { street: '365 EAST ST', city: 'TEWKSBURY', zip: '01876' }
// The registry marks some full street addresses "(NM)" (not mappable); a street with a house number is geocoded anyway.
// PO boxes and "c/o" parts are dropped ("PO Box 269, 45 INDUSTRIAL DR, CANTON 02021" -> 45 INDUSTRIAL DR).
// text: the registry's own address text before the town, for listings placed at the town ("PO BOX 432", "HOMELESS").
export function parseAddress(raw) {
  const all = raw.replace(/\s*\(NM\)/, '').split(',').map(s => s.trim()).filter(Boolean);
  const last = all[all.length - 1] || '';
  const m = last.match(/^(.*?)\s*(\d{5})?$/);
  const city = (m[1] || '').replace(/^MA$/, '').trim();
  const zip = m[2] || '';
  const before = all.slice(0, -1).filter(p => !/^(C\/O|ATTN)\b/i.test(p));
  const parts = before.filter(p => !/^P\.?\s*O\.?\s*BOX\b/i.test(p));
  const first = (parts[0] || '').toUpperCase().replace(/\s+/g, ' ').replace(/^(ONE|TWO|THREE|FOUR|FIVE|SIX|SEVEN|EIGHT|NINE|TEN)\b/, w => WORD_NUM[w]);
  const street = /^\d/.test(first) && !NO_PLACE.test(first)
    ? first.split(' ').filter(w => !/^\d*1\/2$/.test(w)).map((w, i, a) => (i === a.length - 1 && SUFFIX[w]) || w).join(' ') // last word only: COURT ST stays COURT ST
    : '';
  return { street, city, zip, mappable: !!street, text: before.join(', ').toUpperCase().replace(/\s+/g, ' ') };
}

// NH State Police registry address ("NSOR"), as the grid shows it for any state:
// "23 TEMPLE ST 410 NASHUA NH, 03060" with town NASHUA -> { street: '23 TEMPLE ST', city: 'NASHUA', zip: '03060', mappable: true, text }
// The town comes from the registry's city column, so multi-word towns (NEW BOSTON, NORTH HAMPTON) are never guessed.
// Returns null when the address is not in `state`.
const NSOR_SUFFIX = { ...SUFFIX, TRAIL: 'TRL', CIRCLE: 'CIR', HIGHWAY: 'HWY' };
const UNIT = /^(APT|UNIT|LOT|STE|SUITE|RM|ROOM|TRLR|BLDG|BOX|#)$/; // "BOX 3" after a house address is a mail slot, not a PO box
export function parseNsorAddress(address, town, state = 'NH') {
  const m = address.match(new RegExp(`^(.*?)\\s*\\b${state},?\\s*(\\d{5})?\\d*(?:-\\d{4})?$`));
  if (!m) return null;
  let rest = m[1].trim(), postal = town;
  if (rest.endsWith(' ' + town) || rest === town) {
    rest = rest.slice(0, -town.length).trim();
    // "9 MAIN ST WEST LEBANON" in Lebanon, "NORTH CONWAY" in Conway: the direction belongs to the village name
    const v = rest.match(/^(.*\b(?:[A-Z]+|\d\w*)) (NORTH|SOUTH|EAST|WEST|CENTER|CENTRE)$/);
    if (v && (Object.values(NSOR_SUFFIX).includes(v[1].split(' ').at(-1)) || /\d/.test(v[1].split(' ').at(-1)))) { rest = v[1]; postal = v[2] + ' ' + town; }
  } else {
    // Postal village that differs from the town (WEST LEBANON in Lebanon, etc.): drop the trailing words that are not the street
    const w = rest.split(' ');
    const sfx = new Set([...Object.values(NSOR_SUFFIX), 'WAY', 'PKWY', 'EXT', 'PIKE', 'ROW', 'HL', 'PT', 'XING']);
    let cut = w.length;
    for (let i = w.length - 1; i > 0; i--) if (sfx.has(w[i]) || /\d/.test(w[i])) { cut = i + 1; break; }
    postal = w.slice(cut).join(' ') || town;
    rest = w.slice(0, cut).join(' ');
  }
  const text = rest;
  rest = rest.replace(/^(ONE|TWO|THREE|FOUR|FIVE|SIX|SEVEN|EIGHT|NINE|TEN)\b/, w => WORD_NUM[w]);
  // "12 ROUTE 101" / "12 HWY 1": the number after these is the road, not a unit ("DANIEL WEBSTER HWY 1B" is a unit)
  const isRoute = words => new RegExp(`^(ROUTE|RT|RTE|US|${state})$`).test(words.at(-2)) || (words.at(-2) === 'HWY' && words.length === 3);
  // "12-1/2 PLEASANT ST" is pinned on number 12
  const words = rest.split(' ').filter(w => w && !/^1\/2/.test(w)).map((w, i) => i ? NSOR_SUFFIX[w] || w : w.replace(/-1\/2$/, ''));
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
  return { street: mappable ? street : '', city: postal, zip: m[2] || '', mappable, text };
}

// Geocode key: the same building regardless of "North Chelmsford" vs "Chelmsford" spelling
export const geoKey = r => `${r.street}|${r.zip}`;
