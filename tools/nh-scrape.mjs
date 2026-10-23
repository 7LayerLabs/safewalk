// Pulls the NH State Police public registry list for each town into data/nh-raw.csv (no CAPTCHA, opens a Chrome window).
// Keeps only the registry's offender ID and the listed address; names and birth dates are never saved.
// Usage: node tools/nh-scrape.mjs NASHUA HUDSON MERRIMACK LITCHFIELD HOLLIS AMHERST
import { chromium } from 'file:///C:/Users/derek/node_modules/playwright/index.mjs';
import { writeFileSync } from 'node:fs';
const TOWNS = process.argv.slice(2);
const b = await chromium.launch({ channel: 'chrome', headless: false });
const p = await b.newPage();
const out = [];
for (const town of TOWNS) {
  await p.goto('https://business.nh.gov/nsor/', { waitUntil: 'networkidle', timeout: 60000 });
  await p.fill('#ctl00_cphMain_txtCity', town);
  await Promise.all([p.waitForNavigation({ waitUntil: 'networkidle' }), p.click('#ctl00_cphMain_btnSubmit')]);
  const seen = new Set();
  for (let page = 1; ; page++) {
    const rows = await p.$$eval('#ctl00_cphMain_gvwOffender tr', trs => trs.map(tr => {
      const a = tr.querySelector('a[id$="_hypName"]'); if (!a) return null;
      const g = s => (tr.querySelector(`[id$="_${s}"]`)?.innerText || '').trim();
      return { id: a.href.match(/offenderID=(\d+)/)[1], address: g('lblAddress').replace(/\s+/g, ' '), city: g('lblCity'), state: g('lblState') };
    }).filter(Boolean));
    let fresh = 0;
    for (const r of rows) if (!seen.has(r.id)) { seen.add(r.id); out.push({ town, ...r }); fresh++; }
    // Pager: link to the next page number, or "..." that moves to the next block of pages
    const next = await p.$(`#ctl00_cphMain_gvwOffender a[href*="Page$${page + 1}'"]`)
      || (await p.$$(`#ctl00_cphMain_gvwOffender a[href*="Page$"]`)).length && await p.evaluateHandle(n => [...document.querySelectorAll('#ctl00_cphMain_gvwOffender a[href*="Page$"]')].find(a => a.innerText.trim() === '...' && +a.href.match(/Page\$(\d+)/)[1] === n), page + 1).then(h => h.asElement());
    console.log(town, 'page', page, rows.length, 'rows', fresh, 'new');
    if (!next || !fresh) break;
    await Promise.all([p.waitForNavigation({ waitUntil: 'networkidle' }), next.click()]);
  }
}
await b.close();
const q = s => '"' + String(s).replace(/"/g, '""') + '"';
writeFileSync('data/nh-raw.csv', 'town,id,address,city,state\n' + out.map(r => [r.town, r.id, q(r.address), q(r.city), r.state].join(',')).join('\n') + '\n');
console.log('total', out.length);
