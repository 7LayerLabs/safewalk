# SafeWalk

Halloween walking maps (installable phone web app) of addresses on the public state sex offender registries:
all of Massachusetts (SORB, Level 2 and 3) at `/ma/` and all of New Hampshire (State Police public list) at `/nh/`.
LIVE: https://safewalkmap.vercel.app (Vercel project `safewalkmap` on the 7LayerLabs account).

- `site/` is exactly what gets deployed: `index.html` (home page), `ma/`, `nh/`, `vercel.json`.
- `site/ma/index.html` and `site/ma/sw.js` are the master app. `node tools/sync-app.mjs` copies them to `site/nh/` with that
  state's title, description and manifest. Wording, map start and registry links come from `tools/regions.mjs` via each `data.js`.
- `site/lowell/sw.js` and `site/nashua/sw.js` only clean up phones that installed the old city apps; `vercel.json` redirects
  every other old city URL to the state map (`/ma/?town=Lowell`, `/nh/?town=Nashua`).
- `data/` and `tools/` stay local. Raw registry pulls (`data/ma-raw.csv`, `data/nh-state-raw.csv`, `data/ma-cmd/`) are
  gitignored. Names, aliases and birth dates are never saved anywhere; each listing keeps only the registry's own link code.

Deep links: `/ma/?town=Boston`, `/nh/?q=12 Main St, Concord`.
Run locally: `python -m http.server 8793` inside `site/`, then open http://127.0.0.1:8793
Deploy: from `site/`, `vercel deploy --prod --yes --token <token> --scope 7layerlabs-projects`

## Refresh (registries change often; redo right before Halloween)
Massachusetts (needs a person for the CAPTCHA):
1. `node tools/ma-pull.mjs` opens Chrome on the SORB search. The person accepts the terms and CAPTCHA and opens the
   City, County, Zip search, then leaves the window open.
2. Copy `tools/ma-pull-counties.js` to `data/ma-cmd/counties.js`; save the part of `counties.out` after `@@CSV@@` as
   `data/ma-raw-counties.csv`. Then copy `tools/ma-pull-towns.js` to `data/ma-cmd/towns.js` and save its CSV as
   `data/ma-towns-raw.csv`. Both are needed: the county search skips listings the registry could not map (no county on
   file), and on 10/23 the town search found 176 listings and 24 people the county search missed.
   `node tools/ma-merge.mjs` combines them into `data/ma-raw.csv`.
3. `node tools/build-ma.mjs` (update `AS_OF`) geocodes new addresses (Census, then OpenStreetMap), re-checks Census hits
   that landed on a different street, and writes `site/ma/data.js`.

New Hampshire (no CAPTCHA):
1. `node tools/nh-scrape.mjs --state` writes `data/nh-state-raw.csv`.
2. `node tools/build-nh.mjs` (update `AS_OF`) writes `site/nh/data.js`.

Then, if the app changed, bump the cache version in `site/ma/sw.js`, run `node tools/sync-app.mjs`, and deploy.
