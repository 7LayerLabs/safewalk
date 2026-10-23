// Pulls the NH State Police public registry list into a local CSV (no CAPTCHA). Runs a headless Chrome with a normal
// user agent; the registry turns away curl and the "HeadlessChrome" agent.
// Keeps only the registry's offender ID and the listed address; names, aliases and birth dates are never saved.
// Usage: node tools/nh-scrape.mjs NASHUA HUDSON MERRIMACK LITCHFIELD HOLLIS AMHERST   -> data/nh-raw.csv
//        node tools/nh-scrape.mjs --state                                             -> data/nh-state-raw.csv (all 10 counties)
import { chromium } from 'file:///C:/Users/derek/node_modules/playwright/index.mjs';
import { writeFileSync } from 'node:fs';
const COUNTIES = ['Belknap', 'Carroll', 'Cheshire', 'Coos', 'Grafton', 'Hillsborough', 'Merrimack', 'Rockingham', 'Strafford', 'Sullivan'];
const STATE = process.argv[2] === '--state';
const SEARCHES = STATE ? COUNTIES : process.argv.slice(2);
const GRID = '#ctl00_cphMain_gvwOffender';
const b = await chromium.launch({ channel: 'chrome', headless: true, args: ['--disable-gpu', '--renderer-process-limit=1', '--disable-extensions'] });
const ua = `Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/${b.version().split('.')[0]}.0.0.0 Safari/537.36`;
const p = await b.newPage({ userAgent: ua });
const pause = () => new Promise(res => setTimeout(res, 700 + Math.random() * 300)); // be polite between postbacks
const out = [];
const ends = [];
for (const search of SEARCHES) {
  await p.goto('https://business.nh.gov/nsor/', { waitUntil: 'networkidle', timeout: 60000 });
  if (STATE) await p.selectOption('#ctl00_cphMain_ddlCounty', search);
  else await p.fill('#ctl00_cphMain_txtCity', search);
  await Promise.all([p.waitForNavigation({ waitUntil: 'networkidle' }), p.click('#ctl00_cphMain_btnSubmit')]);
  const seen = new Set();
  let city = '', state = '', county = STATE ? search : '', lastRows = 0;
  for (let page = 1; ; page++) {
    const rows = await p.$$eval(`${GRID} tr`, trs => trs.map(tr => {
      const a = tr.querySelector('a[id$="_hypName"]'); if (!a) return null;
      const g = s => (tr.querySelector(`[id$="_${s}"]`)?.innerText || '').trim();
      return { id: a.href.match(/offenderID=(\d+)/)[1], address: g('lblAddress').replace(/\s+/g, ' '), city: g('lblCity'), state: g('lblState'), county: g('lblCounty') };
    }).filter(Boolean));
    // The page number the grid says it is on (the pager shows it as plain text, not a link)
    const shown = await p.$$eval(`${GRID} tr:last-child td span`, ss => ss.map(s => s.innerText.trim()).find(t => /^\d+$/.test(t)) || '');
    if (shown && +shown !== page) throw new Error(`${search}: expected page ${page}, grid shows ${shown}`);
    let fresh = 0;
    for (const r of rows) {
      // City, state and county are only filled on the first row of each city group: carry them forward, across pages too
      if (r.city) { city = r.city; state = r.state; }
      if (r.county) county = r.county;
      if (seen.has(r.id + '|' + r.address)) continue;
      seen.add(r.id + '|' + r.address);
      out.push(STATE ? { county: search, id: r.id, address: r.address, city, state, rowCounty: county } : { town: search, id: r.id, address: r.address, city: r.city, state: r.state });
      fresh++;
    }
    // Pager: link to the next page number, or "..." that moves to the next block of pages
    const next = await p.evaluateHandle(n => [...document.querySelectorAll('#ctl00_cphMain_gvwOffender a[href*="Page$"]')]
      .find(a => +(a.href.match(/Page\$(\d+)/) || [])[1] === n), page + 1).then(h => h.asElement());
    console.log(search, 'page', page, rows.length, 'rows', fresh, 'new');
    lastRows = rows.length;
    if (!next || !fresh) {
      const later = await p.$$eval(`${GRID} a[href*="Page$"]`, (as, n) => as.filter(a => +(a.href.match(/Page\$(\d+)/) || [])[1] > n).length, page);
      ends.push({ search, pages: page, lastPageRows: lastRows, laterPagerLinks: later, stoppedOnRepeat: !fresh, rows: seen.size });
      break;
    }
    await pause();
    await Promise.all([p.waitForNavigation({ waitUntil: 'networkidle' }), next.click()]);
  }
}
await b.close();
const q = s => '"' + String(s).replace(/"/g, '""') + '"';
if (STATE) writeFileSync('data/nh-state-raw.csv', 'county,id,address,city,state,rowCounty\n' + out.map(r => [r.county, r.id, q(r.address), q(r.city), r.state, q(r.rowCounty)].join(',')).join('\n') + '\n');
else writeFileSync('data/nh-raw.csv', 'town,id,address,city,state\n' + out.map(r => [r.town, r.id, q(r.address), q(r.city), r.state].join(',')).join('\n') + '\n');
console.log('END CHECK', JSON.stringify(ends, null, 1));
console.log('total', out.length);
