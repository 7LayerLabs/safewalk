# SafeWalk

Halloween walking maps (installable phone web app) of Level 2 and Level 3 registered addresses from public state registries.
LIVE: https://safewalkmap.vercel.app (Vercel project `safewalkmap` on the 7LayerLabs account).

- `site/` is exactly what gets deployed. `site/index.html` is the city picker; each area lives in its own folder (`site/lowell/`).
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

## Adding a city
Copy `site/lowell/` to `site/<city>/`, point a build at that city's registry pull, and flip its card on `site/index.html`
from "Coming soon" to a live link. NH cities use the NH State Police registry, which needs its own pull and parser.
