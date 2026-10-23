// Run inside the SORB search page by tools/ma-pull.mjs (copy to data/ma-cmd/towns.js). Searches every city/town with no county,
// which also finds listings the county search skips (addresses the registry could not map have no county). Re-running it in the
// same window resumes where it stopped. Save the part of towns.out after @@CSV@@ as data/ma-towns-raw.csv, then run tools/ma-merge.mjs.
// Independent completeness check: search every city/town option (no county) and return listing keys only
const f = [...document.forms].find(f => /countyCityZip/i.test(f.action));
const towns = [...f.elements.cityTown.options].map(o => o.value).filter(Boolean);
const q = s => '"' + String(s).replace(/"/g, '""') + '"';
window.__tp = window.__tp || { lines: ['town,level,type,address,link'], done: {}, fails: [] };
const { lines, done } = window.__tp; const fails = [];
for (const town of towns) {
  if (done[town] != null) continue;
  let table = null, doc;
  for (let attempt = 0; attempt < 3 && !table; attempt++) {
    const fd = new FormData(f);
    fd.set('cityTown', town); fd.set('countyCode', ''); fd.set('zip', ''); fd.set('_submit', 'Search');
    let html = '';
    try { html = await (await fetch(f.action, { method: 'POST', body: new URLSearchParams(fd), credentials: 'include' })).text(); } catch { await new Promise(r => setTimeout(r, 5000)); continue; }
    doc = new DOMParser().parseFromString(html, 'text/html');
    table = [...doc.querySelectorAll('table')].find(x => x.rows.length && /Offender Name/.test(x.rows[0].innerText) && /Address Type/.test(x.rows[0].innerText));
    // A town with nobody listed shows no table but still shows the search parameters
    if (!table && /Search Parameters/i.test(doc.body.innerText)) break;
    if (!table) await new Promise(r => setTimeout(r, 2500));
  }
  if (!table) { if (!doc || !/Search Parameters/i.test(doc.body.innerText)) fails.push(town); else done[town] = 0; continue; }
  const head = [...table.rows[0].cells].map(c => c.innerText.trim().toLowerCase());
  const iName = head.findIndex(h => h.startsWith('offender name')), iLvl = head.indexOf('level'), iType = head.indexOf('address type'), iAddr = head.indexOf('address');
  let n = 0;
  for (const r of [...table.rows].slice(1)) {
    const c = [...r.cells];
    if (c.length < head.length) continue;
    const p = ((c[iName].querySelector('a')?.getAttribute('href') || '').match(/_p=([^&]+)/) || [])[1] || '';
    const addr = c[iAddr].innerText.replace(/\s+/g, ' ').trim().replace(/,\s*MA\s+(\d{5})(-\d{4})?\s*$/, ' $1').replace(/\(Address Not Mappable\)/i, '(NM)');
    lines.push([q(town), c[iLvl].innerText.replace(/\D/g, ''), c[iType].innerText.trim(), q(addr), decodeURIComponent(p)].join(','));
    n++;
  }
  done[town] = n;
  await new Promise(r => setTimeout(r, 400));
}
return JSON.stringify({ towns: towns.length, done: Object.keys(done).length, fails, total: lines.length - 1 }) + '\n@@CSV@@\n' + lines.join('\n') + '\n';
