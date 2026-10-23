// Opens the MA SORB public search in a Chrome window. A person accepts the acknowledgement and CAPTCHA there themselves.
// Once the City/County/Zip search form is on screen, this keeps the window open and runs any script dropped into
// data/ma-cmd/<name>.js inside that page (async function body), writing what it returns to data/ma-cmd/<name>.out.
// Results go straight to disk, so bulk pulls never pass through a chat window. Names are never written.
import { chromium } from 'file:///C:/Users/derek/node_modules/playwright/index.mjs';
import { mkdirSync, readdirSync, readFileSync, writeFileSync, existsSync } from 'node:fs';

const DIR = 'data/ma-cmd';
mkdirSync(DIR, { recursive: true });
// If the window gets closed before the form is reached, it simply opens again
let ctx, closed = true;
async function open() {
  ctx = await chromium.launchPersistentContext(process.env.TEMP + '/safewalk-sorb-profile', { channel: 'chrome', headless: false, viewport: null });
  closed = false;
  ctx.on('close', () => { closed = true; });
  const page = ctx.pages()[0] || await ctx.newPage();
  await page.goto('https://sorb.chs.state.ma.us/sorbpublic/');
  await page.bringToFront();
}
await open();
console.log('Waiting for the person to accept the registry terms and open the City, County, Zip search...');

const onForm = async () => {
  for (const p of ctx.pages()) {
    try { if (await p.evaluate(() => [...document.forms].some(f => /countyCityZip/i.test(f.action)))) return p; } catch {}
  }
  return null;
};
let form = null;
for (let i = 0; i < 1800 && !form; i++) {
  if (closed || !ctx.pages().length) { try { await ctx.close(); } catch {} await open(); }
  form = await onForm();
  if (!form) await new Promise(r => setTimeout(r, 2000));
}
if (!form) { console.log('Timed out waiting for the search form.'); process.exit(1); }
writeFileSync(DIR + '/READY', new Date().toISOString());
console.log('Search form found. Watching', DIR);

for (;;) {
  for (const f of readdirSync(DIR).filter(f => f.endsWith('.js'))) {
    const out = DIR + '/' + f.replace(/\.js$/, '.out');
    if (existsSync(out)) continue;
    const code = readFileSync(DIR + '/' + f, 'utf8');
    let result;
    try {
      const p = (await onForm()) || form;
      result = await p.evaluate(`(async () => { ${code} })()`);
    } catch (e) { result = 'ERROR ' + e.message; }
    writeFileSync(out, typeof result === 'string' ? result : JSON.stringify(result, null, 1));
    console.log('ran', f);
  }
  if (!ctx.pages().length) process.exit(0);
  await new Promise(r => setTimeout(r, 1000));
}
