# apps

Personal, one-off static web apps. Each app lives in its own subdirectory and
they're all served from the same GitHub Pages site.

| App | Directory | What it is |
| --- | --- | --- |
| Signal | [`signal-radio/`](signal-radio/) | Personal internet radio PWA (101X, 98 Rock, The Bone, The Zone, DEF CON) |
| Pump | [`gas-prices/`](gas-prices/) | Regular unleaded at four nearby stations, already compared |
| Slate | [`sports-schedule/`](sports-schedule/) | Today and the next 7 days for the Aggies, Bucs and Lightning |
| Cone | [`hurricane-tracker/`](hurricane-tracker/) | Active NHC storms and invests, filtered to Tampa, Texas and the western Caribbean |

The root `index.html` is the landing page: one card per app, each carrying
that app's highlight so the answer is usually on this screen already.
`landing.js` fills the cards, and it invents nothing — it imports the same
modules the apps use (`compare.js`, `filter.js`, `schedule.js`, …) so a card
can never disagree with the app it opens.

| Card | Shows | Where it comes from |
| --- | --- | --- |
| Signal | A station dropdown and a play button — the card *is* a player | `signal-radio/js/adapters.js`, loaded as a classic script for its `STATIONS` |
| Pump | Cheapest price and station, coloured by the go / no-go verdict | `gas-prices/data/prices.json`, the file the workflow commits, plus any price typed into the app (same origin, same `localStorage`) |
| Slate | The followed team's logo, the matchup, and the next kick / puck drop | ESPN, fetched directly, as the app does; the app's `localStorage` cache paints first |
| Cone | Count of systems in the watched regions, coloured by the worst one | `hurricane-tracker/data/*.json`, the files the workflow commits |

Cards load independently, so a dead ESPN never blanks the storm count. Signal
playback stops when you navigate away from the page — there is no shell
holding the `<audio>` element across pages — and 101X is HLS-only, so it plays
on iOS but not desktop Chrome, exactly as in the app.

When you add a sibling app, add a card here too.

No build step, no dependencies, no backend. Everything is vanilla
HTML/CSS/JS and every path in every app is **relative**, because GitHub Pages
project sites serve from `https://<user>.github.io/<repo>/`, not from the
domain root.

## Run it locally

```bash
python3 -m http.server 8000
# then open http://localhost:8000/
```

A service worker needs a secure context — `http://localhost` counts, so
registration works locally. Opening `index.html` via `file://` does **not**
work (no service worker, no fetch).

## Publish to GitHub Pages

The repo already exists at `github.com/aaronrea/apps`. To publish:

1. **Push** to `main`:

   ```bash
   git push -u origin main
   ```

   (If you're starting from a fresh repo instead: `gh repo create aaronrea/apps
   --public --source=. --push`, or create it in the GitHub UI and
   `git remote add origin git@github.com:aaronrea/apps.git` first.)

2. **Enable Pages**: repo → **Settings** → **Pages** → *Build and deployment* →
   Source: **Deploy from a branch** → Branch: **`main`**, folder: **`/ (root)`**
   → **Save**.

3. Wait ~1 minute for the first build, then open:

   - Landing page: `https://aaronrea.github.io/apps/`
   - Signal: `https://aaronrea.github.io/apps/signal-radio/`

Pages serves over HTTPS, which is what the service worker, "Add to Home
Screen", and background audio all require.

## iOS install test

From Safari on the phone, open the Signal URL → Share → **Add to Home Screen**.
Launch it from the home screen icon (not from Safari) to get the standalone,
no-browser-chrome window, then start a station and lock the phone to check the
lock-screen controls.
