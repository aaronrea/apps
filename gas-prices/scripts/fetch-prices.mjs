#!/usr/bin/env node
/* ---------------------------------------------------------------------------
 * Pump — price fetcher
 *
 * Runs in GitHub Actions (see .github/workflows/gas-prices.yml) and rewrites
 * gas-prices/data/prices.json. Node built-ins only, no dependencies.
 *
 * WHY THIS IS SERVER-SIDE
 * None of these origins send CORS headers, so a static Pages site cannot fetch
 * them from the browser — the request is made and then the response is thrown
 * away by the browser before the page can read it. The fetch therefore happens
 * here, in CI, and the committed prices.json is what the page reads. Moving
 * this into the page would not "simplify" it; it would break it.
 *
 * THE ONE RULE
 * Never write a number we did not actually read from a source. Every adapter
 * is isolated in its own try/catch: one brand changing its markup, rate
 * limiting us, or going down must not take out the other three, and must not
 * turn into a guess. When an adapter fails we carry the previous price forward
 * marked `stale`, so the UI can say "this is old" rather than imply it is
 * current. A price we have never had stays `unavailable` — rendered as an
 * em dash, never as a number.
 *
 * ENDPOINT SHAPES (verified live 2026-08-09, real responses)
 *   Wawa      __NEXT_DATA__ on the store page carries a `fuelTypes` array:
 *             [{ category: "Unleaded", price: 3.819, currency: "USD" }, ...]
 *             Behind Incapsula, which 403s a fraction of requests at random,
 *             so this adapter retries. A browser UA is required.
 *   Costco    An XHR endpoint the warehouse page calls, since the server-
 *             rendered page ships `gasPrices: null`:
 *             /AjaxGetGasPricesService?warehouseid=1364
 *             -> {"1364":{"premium":"4.259","regular":"3.699"}}
 *             Needs a browser UA and a Referer; Akamai 403s the older
 *             /AjaxWarehouseBrowseLookupView endpoint outright.
 *   RaceTrac  Prices are server-rendered into the store page as price chips:
 *             <span ...price-chip__label">Regular 87</span>
 *             <span ...price-chip__value">$3.769</span>
 *   7-Eleven  (re-verified 2026-09-13) The store page is now a Next.js app
 *             shell: the server HTML carries only <meta> tags and the store
 *             data is fetched in the browser from the site's own proxy,
 *             POST /api/v5/stores/search with { lat, lon, radius, limit }.
 *             That returns { results: [ { id: 38565, fuel_data: { grades:
 *             [{ abbr: "RUL", name: "Regular", price: 4059,
 *             price_label: "$4.059" }, ...], last_updated: "..." } } ] }.
 *             No auth needed: the page sends an empty `token` for anonymous
 *             visitors and so do we. The earlier adapter scraped the same
 *             fuelData out of the server-rendered page, which stopped
 *             carrying it at some point after 2026-08-09.
 * ------------------------------------------------------------------------- */

import { readFile, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

import { recordDay, HISTORY_DAYS } from '../js/history.js';

const HERE = dirname(fileURLToPath(import.meta.url));
const DATA_FILE = join(HERE, '..', 'data', 'prices.json');

/* A recent desktop Chrome UA. Several of these origins serve a bot wall to
 * anything that looks automated; this is the difference between 200 and 403. */
const UA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) ' +
  'AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36';

const TIMEOUT_MS = 20000;
const RETRIES = 3;

/* Written into the file once so the shape explains itself to anyone opening
 * data/prices.json without this script next to it. */
const HISTORY_NOTE = `One entry per calendar day (UTC), oldest first, holding only prices actually `
  + `fetched that day — never a stale carry-forward, so a day we could not reach a source has no `
  + `entry rather than a repeated number. Last ${HISTORY_DAYS} days. Drives the direction line in the UI.`;

/* -- fetch helpers -------------------------------------------------------- */

async function get(url, {
  headers = {},
  accept = 'text/html,application/xhtml+xml,*/*;q=0.8',
  method = 'GET',
  body = undefined
} = {}) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    const res = await fetch(url, {
      method,
      body,
      signal: controller.signal,
      redirect: 'follow',
      headers: {
        'User-Agent': UA,
        Accept: accept,
        'Accept-Language': 'en-US,en;q=0.9',
        ...headers
      }
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return await res.text();
  } finally {
    clearTimeout(timer);
  }
}

/* Incapsula and Akamai both 403 a share of requests at random rather than
 * consistently, so a single failure means little. Back off and try again. */
async function withRetry(fn, attempts = RETRIES) {
  let last;
  for (let i = 0; i < attempts; i += 1) {
    try {
      return await fn();
    } catch (err) {
      last = err;
      if (i < attempts - 1) await sleep(1500 * (i + 1));
    }
  }
  throw last;
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/* A price is only accepted if it parses to a plausible pump price. This is the
 * last line of defence against a markup change handing us a phone number or a
 * rewards-points figure and us writing it down as a gas price. */
function parsePrice(raw, label) {
  const n = typeof raw === 'number' ? raw : parseFloat(String(raw).replace(/[^0-9.]/g, ''));
  if (!Number.isFinite(n)) throw new Error(`${label}: could not parse a number from ${JSON.stringify(raw)}`);
  if (n < 1 || n > 12) throw new Error(`${label}: ${n} is not a plausible per-gallon price`);
  return Math.round(n * 1000) / 1000;
}

/* -- adapters ------------------------------------------------------------- */
/* Each returns { price, source } or throws. Nothing else. */

async function fetchWawa() {
  const url = 'https://www.wawa.com/locations/5185';
  const html = await withRetry(() => get(url));

  const m = html.match(/"fuelTypes"\s*:\s*(\[[^\]]*\])/);
  if (!m) throw new Error('wawa: no fuelTypes array in page payload');

  const fuels = JSON.parse(m[1]);
  const unleaded = fuels.find((f) => /^unleaded$/i.test(f.category || ''));
  if (!unleaded) {
    throw new Error(`wawa: no Unleaded entry (saw ${fuels.map((f) => f.category).join(', ')})`);
  }
  return { price: parsePrice(unleaded.price, 'wawa'), source: url };
}

async function fetchCostco() {
  const url = 'https://www.costco.com/AjaxGetGasPricesService?warehouseid=1364';
  const body = await withRetry(() => get(url, {
    accept: 'application/json, text/plain, */*',
    headers: { Referer: 'https://www.costco.com/w/-/fl/bradenton/1364' }
  }));

  const json = JSON.parse(body);
  const entry = json['1364'];
  if (!entry || entry.regular == null) throw new Error('costco: no regular price for warehouse 1364');

  return { price: parsePrice(entry.regular, 'costco'), source: 'https://www.costco.com/w/-/fl/bradenton/1364' };
}

async function fetchRaceTrac() {
  const url = 'https://www.racetrac.com/locations/florida/bradenton/lena';
  const html = await withRetry(() => get(url));

  /* The label and value are adjacent spans inside one price chip. Anchoring on
   * the "Regular" label rather than chip order means a reordered price bar, or
   * a new fuel type appearing, cannot silently hand us diesel. */
  const m = html.match(
    /price-chip__label"[^>]*>\s*Regular[^<]*<\/span>\s*<span[^>]*price-chip__value"[^>]*>\s*\$?\s*([0-9.]+)/i
  );
  if (!m) throw new Error('racetrac: no Regular price chip found');

  return { price: parsePrice(m[1], 'racetrac'), source: url };
}

/* 7-Eleven is the only source here that publishes when it last saw the price,
 * so this adapter reports that instead of the fetch time — a price stamped
 * this morning should age from this morning, not from whenever CI happened to
 * run. */
const SEVEN_ELEVEN = {
  id: 38565,
  page: 'https://www.7-eleven.com/locations/fl/bradenton/11805-sr-70-east-38565',
  /* The store's own coordinates, as the search API reports them. The search
   * is a radius around a point, so we centre it on the store and keep the
   * radius tight; the result is then matched on the store id, never on
   * position in the list, so a new store opening next door cannot swap in. */
  lat: 27.43277,
  lon: -82.424352
};

async function fetchSevenEleven() {
  const url = 'https://www.7-eleven.com/api/v5/stores/search';
  const body = await withRetry(() => get(url, {
    method: 'POST',
    accept: 'application/json, text/plain, */*',
    headers: {
      'Content-Type': 'application/json',
      Referer: SEVEN_ELEVEN.page
    },
    body: JSON.stringify({
      token: '',
      lat: SEVEN_ELEVEN.lat,
      lon: SEVEN_ELEVEN.lon,
      radius: 2,
      limit: 5,
      currentLat: SEVEN_ELEVEN.lat,
      currentLon: SEVEN_ELEVEN.lon,
      selectedFeatures: []
    })
  }));

  const json = JSON.parse(body);
  const results = Array.isArray(json.results) ? json.results : [];
  const store = results.find((r) => Number(r.id) === SEVEN_ELEVEN.id);
  if (!store) {
    throw new Error(`7-eleven: store ${SEVEN_ELEVEN.id} not in search results (saw ${results.map((r) => r.id).join(', ') || 'none'})`);
  }

  const grades = store.fuel_data && Array.isArray(store.fuel_data.grades) ? store.fuel_data.grades : [];
  if (!grades.length) throw new Error('7-eleven: store has no fuel_data.grades');

  const regular = grades.find((g) => g.abbr === 'RUL') || grades.find((g) => /^regular$/i.test(g.name || ''));
  if (!regular) {
    throw new Error(`7-eleven: no Regular grade (saw ${grades.map((g) => g.abbr).join(', ')})`);
  }

  /* price_label is the display string ("$3.799"); `price` is the same number
   * in thousandths (3799). Prefer the label and let parsePrice sanity-check
   * it, falling back to the integer. */
  const price = regular.price_label
    ? parsePrice(regular.price_label, '7-eleven')
    : parsePrice(regular.price / 1000, '7-eleven');

  /* "2026-08-09 12:12:05 -04:00" — not quite ISO 8601; Date can read it once
   * the space before the offset is squared away. */
  const observed = parseLooseDate(store.fuel_data.last_updated);

  return { price, source: SEVEN_ELEVEN.page, observed };
}

function parseLooseDate(text) {
  if (!text) return null;
  const t = Date.parse(String(text).replace(' ', 'T').replace(/\s+/, ''));
  return Number.isFinite(t) ? new Date(t).toISOString() : null;
}

const ADAPTERS = {
  wawa: fetchWawa,
  costco: fetchCostco,
  racetrac: fetchRaceTrac,
  '7-eleven': fetchSevenEleven
};

/* -- main ----------------------------------------------------------------- */

async function main() {
  const previous = JSON.parse(await readFile(DATA_FILE, 'utf8'));
  const now = new Date().toISOString();

  const stations = {};
  let okCount = 0;

  for (const [id, adapter] of Object.entries(ADAPTERS)) {
    const prev = (previous.stations && previous.stations[id]) || {};

    try {
      const { price, source, observed } = await adapter();
      /* An adapter that knows when the price was actually set says so; the
       * rest can only report when we looked. */
      stations[id] = { price, observed: observed || now, status: 'ok', source, note: null };
      okCount += 1;
      console.log(`ok        ${id.padEnd(10)} $${price.toFixed(3)}`);
    } catch (err) {
      const reason = err && err.message ? err.message : String(err);

      if (typeof prev.price === 'number' && Number.isFinite(prev.price)) {
        /* Carry the last real number forward, explicitly marked stale, keeping
         * the timestamp of when it was actually observed. */
        stations[id] = {
          price: prev.price,
          observed: prev.observed || null,
          status: 'stale',
          source: prev.source || null,
          note: `Last fetch failed: ${reason}`
        };
        console.log(`stale     ${id.padEnd(10)} kept $${prev.price.toFixed(3)} — ${reason}`);
      } else {
        stations[id] = { price: null, observed: null, status: 'unavailable', source: null, note: reason };
        console.log(`unavail   ${id.padEnd(10)} ${reason}`);
      }
    }
  }

  /* History is folded in from the run we just did, not recomputed: the file is
   * the only record there is. Later runs on the same day overwrite that day's
   * entry, so a day settles on the last price actually observed. */
  const history = recordDay(previous.history, stations, now);

  const next = {
    _comment: previous._comment,
    _status_values: previous._status_values,
    _history: previous._history || HISTORY_NOTE,
    updated: now,
    stations,
    history
  };

  const serialised = `${JSON.stringify(next, null, 2)}\n`;
  await writeFile(DATA_FILE, serialised, 'utf8');

  console.log(`\n${okCount}/${Object.keys(ADAPTERS).length} fetched live; `
    + `${history.length} day(s) of history; wrote ${DATA_FILE}`);

  /* A run where nothing at all came back is a failure worth seeing in the
   * Actions log, but the file is still written (everything downgraded to
   * stale), so the site keeps rendering honestly either way. */
  if (okCount === 0) {
    console.error('no adapter succeeded — every station is stale or unavailable');
    process.exitCode = 1;
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
