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

Verified live on 2026-08-09 (7-Eleven re-verified 2026-09-13), and this is
what each adapter actually keys on:

| Station | Source | Shape |
| --- | --- | --- |
| Wawa | Store page | `__NEXT_DATA__` → `fuelTypes[]` → `category: "Unleaded"` |
| Costco | `AjaxGetGasPricesService` | `{"<id>":{"regular":"3.699"}}` |
| RaceTrac | Store page | Server-rendered price chip, keyed on the `Regular` label |
| 7-Eleven | `/api/v5/stores/search` | `results[]` → `id: 38565` → `fuel_data.grades[]` → `abbr: "RUL"` → `price_label` |

All four publish. 7-Eleven's store page turned into a Next.js app shell at
some point after 2026-08-09 (re-verified 2026-09-13): the server HTML now carries only
`<meta>` tags, and the browser fetches the store record from the site's own
proxy, `POST /api/v5/stores/search`, with the store's coordinates. The adapter
calls that endpoint directly, with a tight radius, and matches on the store
**id** rather than list position. No token is needed; the page itself sends an
empty one for anonymous visitors. It is also the only source that publishes
**when it last saw the price** (`last_updated`), so that adapter reports the
real observation time rather than the time CI happened to run — a price
stamped this morning ages from this morning.

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

## Which way it's going

Each row carries a one-line direction under the price — `▼ 9¢ since
yesterday`, `▲ 5¢ since yesterday`, `▬ flat since yesterday`. The point is
the one question a single snapshot can't answer: is this the top of a run-up
or the bottom of a slide?

The fetcher keeps the last **7 days** in a `history` array inside
`data/prices.json` — one entry per calendar day (America/New_York), oldest first:

```json
"history": [
  { "date": "2026-09-20", "prices": { "wawa": 4.289, "racetrac": 4.19 } }
]
```

One entry per **day**, not per run. The workflow fetches every two hours, so
run-to-run differences are mostly the same number repeated; a station that
moved 3¢ between the morning and evening runs moved 3¢ *today*. Later runs on
the same day overwrite that day's entry, so a day settles on the last price
actually observed.

The one rule of the fetcher applies here too, and it is the reason this is
worth more than a sparkline: **only an `ok` price is ever recorded.** A `stale`
carry-forward is the previous day's observation wearing today's date, and
writing it would manufacture a flat line out of a broken scraper. A day we
couldn't reach a source gets no entry at all. Two things follow:

- A **stale row shows no direction.** Its price *is* the old price, so
  "unchanged" would be a claim we can't make. Costco goes quiet here whenever
  it's 429ing, which is the honest answer.
- A **gap widens the baseline and says so** — `▼ 9¢ since Sep 19` rather than
  calling three days "yesterday".

Days are bucketed on each station's own `observed` stamp, not on when CI ran,
so 7-Eleven's self-reported `last_updated` files its price under the day it
was actually set — and on **Bradenton's** calendar, not UTC's. That is
load-bearing rather than fussy: the workflow runs at `:43` every two hours, so
the 00:43 and 02:43 UTC slots are 8:43pm and 10:43pm ET *the night before*.
Bucketing those on the UTC date would move the day boundary to 8pm and let a
price from last night count as today's baseline.

### Turned

When the last move reverses the one before it, the line adds `· turned up` /
`· turned down` and is the only thing on the row rendered in the accent
colour. A flat day breaks the comparison rather than counting as a reversal.

Direction is deliberately **monochrome**: red, amber and green are load-bearing
in this app (over the line, make the trip, fill up), and a price falling is not
the same claim as a price being good. The glyph carries the direction; the
colour is reserved for the verdict.

The history was seeded from the `prices.json` blobs already in git — the same
`recordDay()` the fetcher uses, replayed over past commits — so the feature
had a week of real data the day it shipped rather than starting empty.

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

They also cover the history: that a stale carry-forward is never recorded,
that a second run the same day overwrites rather than appends, that the cap
drops the oldest day first, that a stale row gets no direction, that a gap
widens the baseline, that a flat day is not a reversal, and that the late
evening runs land on the Bradenton day they ran on rather than the next UTC
one, either side of the daylight-saving change.

## The schedule

`.github/workflows/gas-prices.yml` runs the fetcher **every two hours** at
`:43` past, checks the comparison logic, and commits `data/prices.json`
**only when it changed** (which, since a successful fetch always refreshes
`observed` even when the price itself didn't move, means most successful runs
commit something). It needs `contents: write`. It can also be run on demand
from the Actions tab.

The off-hour minute and the every-two-hours cadence are both deliberate, and
they were arrived at the hard way. GitHub queues scheduled workflows hardest
at round minutes on the hour, so the original `:05`/`:10` schedule landed 2-4
hours late; moving to `:37` helped, but checking the run history for
09-11..09-17 showed the morning slot was not late, it was **dropped** — every
single day — while the other two landed 1.5-3.5 hours behind. GitHub sheds
scheduled runs under load as well as delaying them, and roughly half of what
is asked for is what arrives. The answer was not a better minute but more
slots: at every two hours, losing half of them still leaves a run every ~4
hours, and the three pre-dawn slots give the commute several chances at a
fresh number. The repo is public, so Actions minutes are free.

## Known rough edges

- **Scheduled workflows are best-effort, and some never run at all.** GitHub
  can queue a cron trigger for hours under load, worse at popular minutes,
  and it silently drops a share of them outright. An off-hour minute and
  twelve slots a day reduce the blast radius; they don't eliminate it. If the
  app is stale first thing in the morning again, check which of the overnight
  runs actually landed in the Actions tab before assuming the fetcher broke.
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
