// The app page and worker live once, in site/ma. This copies them into every state folder and fills in each
// state's page title, description and install name from tools/regions.mjs. Run it after editing site/ma.
import { readFileSync, writeFileSync, mkdirSync, cpSync } from 'node:fs';
import { REGIONS } from './regions.mjs';

const MASTER = 'ma';
const STATES = ['ma', 'nh'];
const attr = s => s.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;');

const page = readFileSync(`site/${MASTER}/index.html`, 'utf8');
const worker = readFileSync(`site/${MASTER}/sw.js`, 'utf8');
for (const slug of STATES) {
  const r = REGIONS[slug];
  const title = `SafeWalk ${r.name}`, short = `SafeWalk ${r.state}`;
  mkdirSync(`site/${slug}`, { recursive: true });
  writeFileSync(`site/${slug}/index.html`, page
    .replace(/<title>.*<\/title>/, `<title>${attr(title)}</title>`)
    .replace(/<meta name="description" content="[^"]*">/, `<meta name="description" content="${attr(r.description)}">`)
    .replace(/<meta name="apple-mobile-web-app-title" content="[^"]*">/, `<meta name="apple-mobile-web-app-title" content="${attr(short)}">`));
  if (slug !== MASTER) writeFileSync(`site/${slug}/sw.js`, worker);
  cpSync('site/icons', `site/${slug}/icons`, { recursive: true });
  const manifest = {
    name: title, short_name: short, description: r.description,
    start_url: './', scope: './', display: 'standalone', orientation: 'portrait',
    background_color: '#0e1014', theme_color: '#0e1014',
    icons: [
      { src: 'icons/icon-192.png', sizes: '192x192', type: 'image/png' },
      { src: 'icons/icon-512.png', sizes: '512x512', type: 'image/png' },
      { src: 'icons/icon-maskable-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
      { src: 'icons/icon.svg', sizes: 'any', type: 'image/svg+xml' },
    ],
  };
  writeFileSync(`site/${slug}/manifest.webmanifest`, JSON.stringify(manifest, null, 2) + '\n');
  console.log(`site/${slug}: ${title}`);
}
