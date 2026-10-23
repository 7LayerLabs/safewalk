// Run inside the SORB search page by tools/ma-pull.mjs: copy to data/ma-cmd/pull.js, then save the CSV part of
// data/ma-cmd/pull.out (after the @@CSV@@ line) as data/ma-raw.csv. Only level, address type, address and link code leave the page.
const f = [...document.forms].find(f => /countyCityZip/i.test(f.action));
const counties = [...f.elements.countyCode.options].map(o => o.value).filter(Boolean);
const q = s => '"' + String(s).replace(/"/g, '""') + '"';
const lines = ['county,level,type,address,link'];
const counts = {};
for (const county of counties) {
  let doc, table;
  for (let attempt = 0; attempt < 3 && !table; attempt++) {
    const fd = new FormData(f);
    fd.set('cityTown', ''); fd.set('countyCode', county); fd.set('zip', ''); fd.set('_submit', 'Search');
    doc = new DOMParser().parseFromString(await (await fetch(f.action, { method: 'POST', body: new URLSearchParams(fd), credentials: 'include' })).text(), 'text/html');
    table = [...doc.querySelectorAll('table')].find(x => x.rows.length && /Offender Name/.test(x.rows[0].innerText) && /Address Type/.test(x.rows[0].innerText));
    if (!table) await new Promise(r => setTimeout(r, 3000));
  }
  if (!table) { counts[county] = 'NO TABLE'; continue; }
  const head = [...table.rows[0].cells].map(c => c.innerText.trim().toLowerCase());
  const iName = head.findIndex(h => h.startsWith('offender name')), iLvl = head.indexOf('level'), iType = head.indexOf('address type'), iAddr = head.indexOf('address');
  let n = 0, noLink = 0;
  for (const r of [...table.rows].slice(1)) {
    const c = [...r.cells];
    if (c.length < head.length) continue;
    const href = c[iName].querySelector('a')?.getAttribute('href') || '';
    const p = (href.match(/_p=([^&]+)/) || [])[1] || '';
    if (!p) { noLink++; continue; }
    // Same address shape as the earlier Lowell pull: "12 MAIN ST, APT 2, LOWELL 01852", "LOWELL, MA (NM)"
    const addr = c[iAddr].innerText.replace(/\s+/g, ' ').trim().replace(/,\s*MA\s+(\d{5})(-\d{4})?\s*$/, ' $1').replace(/\(Address Not Mappable\)/i, '(NM)');
    lines.push([county, c[iLvl].innerText.replace(/\D/g, ''), c[iType].innerText.trim(), q(addr), decodeURIComponent(p)].join(','));
    n++;
  }
  counts[county] = n + (noLink ? ` (+${noLink} without link)` : '');
  await new Promise(r => setTimeout(r, 1000));
}
return JSON.stringify(counts) + '\n@@CSV@@\n' + lines.join('\n') + '\n';
