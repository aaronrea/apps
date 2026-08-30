# Cone

Active NHC systems — named storms and designated invests — filtered down to
what could plausibly reach Tampa/the Gulf Coast, Texas, Florida, the Bahamas,
or Honduras/the western Caribbean. No pan-and-zoom map, no worldwide list to
scroll past: just the threats that matter, already filtered.

## The filter

One combined region: lat 8–31°N, lon 98–60°W. That covers the Gulf of
America/Mexico (Tampa, the Texas coast), the western Caribbean (Honduras),
the Florida peninsula and the Bahamas corridor, plus enough open Atlantic
that a storm is caught on approach rather than only once it's already there.

A storm with a known position is filtered by that box. An early invest from
the Tropical Weather Outlook often doesn't have a position yet — those are
kept instead by matching the outlook's own prose against the place names that
matter (Gulf, Caribbean, Florida, Bahamas, Yucatan, Honduras, Bay of
Campeche, Texas, Louisiana, the Windward/Leeward Islands). See
`js/filter.js` — it's the one file both the fetcher and the page import, so
the box and the keyword list can't drift between them.

## Where the data comes from

**The page never fetches NHC.** It can't: `CurrentStorms.json` and the
outlook feed send no CORS headers, so a browser request would be made and
then thrown away unread. The fetching happens in GitHub Actions, which
commits `data/current-storms.json` and `data/outlook-atlantic.json`; the
page only ever reads those two files.

| Source | What it gives | Shape |
| --- | --- | --- |
| [`CurrentStorms.json`](https://www.nhc.noaa.gov/CurrentStorms.json) | Every active named storm and designated invest, worldwide | JSON |
| [Atlantic outlook RSS](https://www.nhc.noaa.gov/index-at.xml) | Prose on disturbances that don't have a full advisory yet, plus formation-chance percentages | RSS, one `<item>` wrapping HTML-escaped, `<br />`-broken plain text |

The outlook has no clean JSON, so `js/outlook.js` parses the plain-text
product out of the RSS CDATA: each disturbance is a heading line ending in
`):` (`Northern Gulf of America (AL97):`), followed by a body paragraph and
two `* Formation chance through 48 hours/7 days...` bullets. `scripts/test-
filter.mjs` runs that parser against `fixtures/outlook-sample.xml`, a real
response captured live on 2026-08-30 — not a made-up shape.

### The one rule of the fetcher

Two unrelated NHC products, fetched independently, isolated in their own
`try`/`catch` — one going down or changing shape must not blank the other.
On failure, the previous committed file is carried forward with `ok: false`
and an `error` message, rather than being overwritten with nothing. The
browser re-checks the age of `updated` on top of that (`js/store.js`,
`isStaleAge` in `js/format.js`), so a workflow that has quietly stopped
running eventually shows as stale even if it never technically fails.

## Classifications

| Code | Meaning |
| --- | --- |
| `TD` | Tropical Depression |
| `STD` | Subtropical Depression |
| `TS` | Tropical Storm |
| `STS` | Subtropical Storm |
| `HU` | Hurricane |
| `PTC` | Post-Tropical Cyclone |

## Run it locally

```bash
# from the repo root
python3 -m http.server 8000
# then open http://localhost:8000/hurricane-tracker/
```

Fetch storms + outlook into `data/*.json` by hand:

```bash
node hurricane-tracker/scripts/fetch-storms.mjs
```

Run the tests (no framework, no dependencies):

```bash
node hurricane-tracker/scripts/test-filter.mjs
```

The tests cover the region box (including its edges and missing
coordinates), the keyword fallback, classification/formation-chance tone
mapping, and the outlook parser against the real captured fixture.

## The schedule

`.github/workflows/hurricane-tracker.yml` runs the fetcher hourly, runs the
tests, and commits the two `data/*.json` files **only when something
changed**. NHC itself only updates `CurrentStorms.json` roughly every 6
hours (more often near landfall), so most hourly runs are no-ops — that's
the point: the page is never more than an hour behind whenever NHC does
publish something new. It needs `contents: write` and can be run on demand
from the Actions tab.

## Known rough edges

- **The outlook parser is regex against prose**, not a real grammar. NHC has
  been consistent about the heading/bullet shape for years, but a format
  change would need a fixture update and a parser fix together — that's
  what `fixtures/outlook-sample.xml` and `test-filter.mjs` are for.
- **No map.** `bestTrackGIS` / the MapServer layer NHC publishes would
  support one, but this is a list-first dashboard on purpose — the question
  it answers is "is there anything I need to worry about," not "where
  exactly is it."
- A storm can be in the region box while its outlook-stage entry (before it
  had a position) is independently keyword-matched — the two lists are not
  deduplicated against each other, since NHC drops the outlook entry once a
  system gets a `CurrentStorms.json` record of its own in practice.
