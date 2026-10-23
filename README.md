# SafeWalk

Halloween walking maps (installable phone web app) of registered addresses from public state registries (MA Level 2 and 3; NH public list).
LIVE: https://safewalkmap.vercel.app (Vercel project `safewalkmap` on the 7LayerLabs account).

- `site/` is exactly what gets deployed. `site/index.html` is the city picker; each area lives in its own folder (`site/lowell/`, `site/nashua/`).
- `site/lowell/index.html` and `sw.js` are the master app. Every city folder runs the same page; city wording, center,
  state and registry links come from the `region` block in its `data.js` (settings in `tools/regions.mjs`).
- `data/` and `tools/` stay local and are never deployed.

Names and photos are never stored. Each listing carries only the registry's own page code (data/sorb-links.csv), so a pin's
"See who" button opens that person's official registry page. Hot spots shows a heat map and the 10 busiest quarter-mile areas.

Run locally: `python -m http.server 8793` inside `site/`, then open http://127.0.0.1:8793
Deploy: from `site/`, `vercel deploy --prod --yes --token <token> --scope 7layerlabs-projects --name safewalkmap`

## Refresh the Lowell data (registry changes often; redo right before Halloween)
1. A person opens https://sorb.chs.state.ma.us/sorbpublic/ and accepts the acknowledgement + CAPTCHA themselves.
2. In that tab, POST the "City, County, Zip" form for each town and export the results table to `data/sorb-raw.csv`
   (columns: town code, level, status, type, address, salted name hash for de-duping, dupe flag). No names.
   Save each row's viewOffenderDetails `_p` code, in the same row order, to `data/sorb-links.csv`; the build checks every row matches.
3. `node tools/geocode.mjs` looks up only new addresses (Census first, OpenStreetMap for misses) into `data/geocache.json`.
   `node tools/check-geocodes.mjs` flags Census guesses more than 150 m from an OSM building; fix those in the cache.
4. `node tools/build-data.mjs` writes `site/lowell/data.js` (update `AS_OF` in that script).
5. Bump the cache name in `site/lowell/sw.js` so installed phones pick up the new data, then deploy.

## Refresh the Nashua data (NH State Police registry, no CAPTCHA)
1. `node tools/nh-scrape.mjs NASHUA HUDSON MERRIMACK LITCHFIELD HOLLIS AMHERST` opens Chrome and saves `data/nh-raw.csv`
   (registry offender ID and listed address only).
2. `node tools/build-nashua.mjs` geocodes new addresses, writes `site/nashua/data.js` (update `AS_OF`), and copies the
   master app, worker, icons and manifest from `site/lowell/`. Re-run it after any change to the Lowell app.
3. Bump the cache version in `site/lowell/sw.js` first if the app changed, then deploy.

## Adding a city
Add its settings to `tools/regions.mjs`, pull its registry, write a build like `tools/build-nashua.mjs` that outputs
`site/<city>/data.js` and copies the master app, then flip its card on `site/index.html` from "Coming soon" to a live link.
