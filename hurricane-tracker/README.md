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
Campeche, Texas, Louisiana, the Windward/Leeward Islands, Central America,
Tehuantepec, "eastern Pacific"). See `js/filter.js` — it's the one file both
the fetcher and the page import, so the boxes and the keyword lists can't
drift between them.

### The Pacific side (late-season back door)

From October on, Atlantic genesis moves out of the tropical Atlantic and into
the western Caribbean and Gulf — usually off a Central American Gyre, a broad
low over the isthmus that spawns storms on *both* coasts at once. In 2024 one
gyre produced Helene (Caribbean), John (eastern Pacific) and then, from its
remnants plus those of an unnamed eastern Pacific storm, Milton in the Bay of
Campeche. Occasionally a Pacific system crosses outright: eastern Pacific TD
Eleven-E went ashore at Salina Cruz in September 2010 and re-formed in the
Bay of Campeche as Hermine two days later. Intact crossings are rare (five in
the record, four of them in October); the gyre/remnant seeding is not.

So the page watches the Pacific side of the isthmus too, in two ways:

- **Crossover watch on named systems.** `CurrentStorms.json` carries a
  position and motion for every eastern Pacific storm. One is flagged when it
  is in the `PACIFIC_CROSSOVER_BOX` (lat 8–18°N, lon 100–77°W — Acapulco to
  Costa Rica, the only coast from which a crossing reaches the Bay of
  Campeche or the western Caribbean) **and** is not simply heading west:
  motion outside the 225–290° band, or 5 mph or slower, or not yet known.
  The basin comes from the storm id (`ep…`), not the bin number, since a
  crossed-over storm keeps its id.
- **Eastern Pacific outlook.** The `index-ep.xml` feed is fetched and parsed
  exactly like the Atlantic one, but kept by a narrower keyword list
  (Tehuantepec, southern Mexico, Oaxaca, Chiapas, Guatemala, El Salvador,
  Central America, Honduras, Nicaragua, Bay of Campeche, the Gulf, the
  Caribbean). Baja and "southwestern Mexico" — Acapulco and west — are
  deliberately not in it: a landfall there dies over the Sierra Madre.

Neither is "in your regions." Pacific-side systems are excluded from
`inRegion` (the region box's west edge is east of Acapulco, so without the
basin check a storm in the Gulf of Tehuantepec would read as a Gulf Coast
threat), listed in their own section with capped tones, and only reach the
banner when the regions are otherwise quiet. When the Atlantic outlook has a
Gulf/western-Caribbean/Central-America area *and* something is flagged on
the Pacific side, the banner adds a one-line Central American Gyre note.

## Where the data comes from

**The page never fetches NHC.** It can't: `CurrentStorms.json` and the
outlook feed send no CORS headers, so a browser request would be made and
then thrown away unread. The fetching happens in GitHub Actions, which
commits `data/current-storms.json`, `data/outlook-atlantic.json` and
`data/outlook-pacific.json`; the page only ever reads those three files.

| Source | What it gives | Shape |
| --- | --- | --- |
| [`CurrentStorms.json`](https://www.nhc.noaa.gov/CurrentStorms.json) | Every active named storm and designated invest, worldwide | JSON |
| [Atlantic outlook RSS](https://www.nhc.noaa.gov/index-at.xml) | Prose on disturbances that don't have a full advisory yet, plus formation-chance percentages | RSS, one `<item>` wrapping HTML-escaped, `<br />`-broken plain text |
| [Eastern Pacific outlook RSS](https://www.nhc.noaa.gov/index-ep.xml) | The same, for the other side of Central America | Same shape as the Atlantic feed |

The outlook has no clean JSON, so `js/outlook.js` parses the plain-text
product out of the RSS CDATA: each disturbance is a heading line ending in
`:`, with an optional parenthetical (`Northern Gulf of America (AL97):`,
`Near Puerto Rico (Remnants of Dolly):`, or just `Bay of Campeche:`),
followed by a body paragraph and two `* Formation chance through 48 hours/7
days...` bullets. The preamble and the `Active Systems:` paragraph end in a
colon too, so a block only counts as a disturbance if it carries the
formation bullets, and a heading must start a paragraph (blank line before
it) so a wrapped body line ending in a colon can't split one. `scripts/test-
filter.mjs` runs the parser against three real captured responses in
`fixtures/` (Atlantic with parenthetical headings, Atlantic with a plain
heading, eastern Pacific) — not made-up shapes.

### The one rule of the fetcher

Three unrelated NHC products, fetched independently, isolated in their own
`try`/`catch` — one going down or changing shape must not blank the others.
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
coordinates), the keyword fallback for both basins, basin detection, the
Pacific crossover rule (modelled on the real cases: Eleven-E/Hermine 2010,
John 2024, and today's harmlessly westbound systems), the gyre note,
classification/formation-chance tone mapping, and the outlook parser against
the real captured fixtures.

## The schedule

`.github/workflows/hurricane-tracker.yml` runs the fetcher every 3 hours,
runs the tests, and commits the three `data/*.json` files **only when
something changed**. That cadence isn't arbitrary — NHC issues routine
advisories at 5/11/5/11 AM/PM ET and the Tropical Weather Outlook (plus
intermediate advisories, when a system is close enough to land to need
them) at 2/8/2/8 AM/PM ET. Interleaved, both products land on the same
every-3-hour clock, so the workflow's cron is set to match it (in EDT —
see the comment in the workflow for the small, accepted drift during the
EST tail of hurricane season) rather than just polling often enough to
probably not miss anything. It needs `contents: write` and can be run on
demand from the Actions tab.

## Known rough edges

- **The outlook parser is regex against prose**, not a real grammar. NHC has
  been consistent about the heading/bullet shape for years, but a format
  change would need a fixture update and a parser fix together — that's
  what `fixtures/outlook-sample.xml` and `test-filter.mjs` are for.
- **No map.** `bestTrackGIS` / the MapServer layer NHC publishes would
  support one, but this is a list-first dashboard on purpose — the question
  it answers is "is there anything I need to worry about," not "where
  exactly is it."
- **The crossover watch is a heads-up, not a forecast.** Position plus
  "not heading west" on the right stretch of coast is the setup every
  historical crossing shared, but most storms that match will simply make
  landfall in southern Mexico and rain out. The Atlantic outlook is still
  where a real Gulf threat shows up first — the watch exists so it isn't a
  surprise when it does.
- A storm can be in the region box while its outlook-stage entry (before it
  had a position) is independently keyword-matched — the two lists are not
  deduplicated against each other, since NHC drops the outlook entry once a
  system gets a `CurrentStorms.json` record of its own in practice.
