# Pump

GasBuddy, pre-zoomed to four stations. Regular unleaded only. No map to pan,
no radius to widen — just the four, sorted cheapest first, with the comparison
already done.

Wawa, Costco, RaceTrac, 7-Eleven. Which specific store each one is stays out
of the UI; see [Anonymity](#anonymity) for how far that actually goes.

## The rule

The list is sorted cheapest first, and stations with no price sink to the
bottom rather than sorting as if they were free.

Costco is the benchmark — assumed cheapest, but **computed** rather than
assumed, so the day it isn't, the app says so instead of lying.

Wawa is preferred and gets the headline verdict. Anything more than **5%**
over Costco is flagged red — strictly more than, so exactly 5.0% is not red.

The roles still drive the logic but are no longer labelled on screen: the
sorting is presentational and is computed *after* the verdict, so ranking can
never change the answer. Wawa can sit dead last by price and still be the
recommendation.

> **Unconfirmed:** the 5% rule is applied to Wawa too — preferred, but not
> exempt. Under the line the answer is always *fill up at Wawa*; over it,
> *worth the Costco run*. This reading has not been confirmed. If Wawa was
> meant to be exempt (always the answer, whatever the gap), or the cutoff was
> meant to be cents-per-gallon rather than a percentage, the change is one
> function in `js/compare.js` — `verdict()` — and the threshold constant in
> `js/stations.js`.

## Where the prices come from

**The page never fetches a gas station.** It can't: none of these origins send
CORS headers, so a browser request is made and then thrown away unread. The
fetching happens in GitHub Actions, which commits `data/prices.json`; the page
only ever reads that file. Moving the fetch into the page would not simplify
it — it would break it.

Verified live on 2026-08-09, and this is what each adapter actually keys on:

| Station | Source | Shape |
| --- | --- | --- |
| Wawa | Store page | `__NEXT_DATA__` → `fuelTypes[]` → `category: "Unleaded"` |
| Costco | `AjaxGetGasPricesService` | `{"<id>":{"regular":"3.699"}}` |
| RaceTrac | Store page | Server-rendered price chip, keyed on the `Regular` label |
| 7-Eleven | Store page | `fuelData.grades[]` → `abbr: "RUL"` → `price_label` |

All four publish. 7-Eleven's is easy to miss: its JSON is escape-encoded
inside a script string, so it is spelled `\"price\":` in the raw bytes and a
naive search for `"price":` finds nothing. It is also the only source that
publishes **when it last saw the price** (`last_updated`), so that adapter
reports the real observation time rather than the time CI happened to run —
a price stamped this morning ages from this morning.

Both Wawa (Incapsula) and Costco (Akamai) sit behind bot protection that
rejects a share of requests at random, so those adapters retry and send a
browser User-Agent. Costco's warehouse page ships `gasPrices: null` and fills
it in over XHR, which is why the adapter calls that endpoint directly.

### The one rule of the fetcher

**Never write a number we did not read from a source.** Every adapter is
isolated in its own `try`/`catch`: one brand changing its markup must not take
out the other three, and must not turn into a guess. On failure the previous
price is carried forward marked `stale`, so the UI can say *this is old*
rather than imply it is current. A price that has never been fetched stays
`unavailable` and renders as an em dash. Anything that doesn't parse to a
plausible per-gallon number (1–12 USD) is rejected rather than stored.

`status` is one of:

- `ok` — fetched successfully on this run
- `stale` — this run failed; the price is the last one actually observed
- `unavailable` — no price has ever been fetched from this source

An `ok` price older than 12 hours is downgraded to `stale` in the browser, so
a workflow that has quietly stopped running is visible rather than invisible.

## Typing a price in

Every row has an **Edit** (or **Add price**) button. A typed price is written
to `localStorage`, beats the fetched one, and is tagged `typed`. If you are
standing at the pump looking at the sign, the sign is right and the scraper is
wrong.

Typed prices are cleared per-row (**Use fetched**) or all at once, and are
demoted to `stale` after 12 hours like any other price — a number from Monday
is Monday's number regardless of who wrote it down.

## Anonymity

The UI shows four brand names, four prices and nothing else. No street
addresses, no store numbers, no cross streets, and no "on the daily loop"
label — the roles that drive the verdict are not rendered, and the station
names are plain text rather than links to their store pages.

**This is cosmetic, not real.** The scrape URLs in `js/stations.js` pin the
exact four stores, and this is a public repo, so anyone reading the source can
see precisely which ones. The fetcher cannot work without them.

If the goal is for the *stores* to be unidentifiable rather than just
un-displayed, the options are, roughly in order of effort:

1. Make the repo private (Pages then needs a paid plan).
2. Move the URLs into an Actions secret, so the config holds ids and the
   workflow supplies the addresses at fetch time.
3. Drop the fetcher and use manual entry only.

## Run it locally

```bash
# from the repo root
python3 -m http.server 8000
# then open http://localhost:8000/gas-prices/
```

Fetch prices into `data/prices.json` by hand:

```bash
node gas-prices/scripts/fetch-prices.mjs
```

Run the tests (no framework, no dependencies):

```bash
node gas-prices/scripts/test-compare.mjs
```

The tests cover the 5% math, the exactly-5.0% boundary from both sides of its
floating-point error, a missing benchmark, no prices at all, Costco not
actually being cheapest, and the override merge.

## The schedule

`.github/workflows/gas-prices.yml` runs the fetcher at roughly 7am, 1pm and
7pm ET, runs the tests, and commits `data/prices.json` **only when it
changed**. It needs `contents: write`. It can also be run on demand from the
Actions tab.

## Known rough edges

- **The bot walls are the fragile part.** Wawa and Costco 403 a fraction of
  requests; the retries handle the usual case, but a run that fails entirely
  leaves everything stale (visibly so) and fails the job.
- **7-Eleven updates roughly daily** ("gas prices updated within 24hrs"), and
  because that adapter reports the source's own timestamp rather than the
  fetch time, its row will legitimately show `stale` whenever the published
  price is more than 12 hours old. That is accurate, not a bug — but it will
  look like one if you are expecting all four rows to age together.
- The percentage is shown to one decimal, except within 0.05% of the
  threshold, where it switches to three so a red row can never read `+5.0%`
  while the rule on the same screen says *more than 5%*.
