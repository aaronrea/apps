/* ---------------------------------------------------------------------------
 * Pump — comparison logic
 *
 * Pure functions, no DOM, no fetch. This is the part worth being careful
 * about, so it lives on its own and is exercised by scripts/test-compare.mjs.
 *
 * The rules, verbatim from the brief:
 *   - Costco is the benchmark. It is assumed cheapest, but nothing here
 *     depends on that assumption holding — if Costco is somehow not the
 *     cheapest, the math still reads correctly (negative percentages).
 *   - Wawa is preferred: it is on the daily loop, so it is the default
 *     answer and gets an explicit go / no-go verdict.
 *   - Anything else is red when it is worse than 5% more expensive than
 *     Costco.
 * ------------------------------------------------------------------------- */

import { THRESHOLD_PCT } from './stations.js';

/* A price is usable only if it is a real, finite, positive number. Anything
 * else — null, undefined, NaN, a string that didn't parse, 0 — is "we don't
 * know", which is a distinct state from "expensive" and must never be
 * rendered as a number. */
export function isUsablePrice(p) {
  return typeof p === 'number' && Number.isFinite(p) && p > 0;
}

/* Percent difference against the benchmark. Positive = more expensive. */
export function pctDiff(price, benchmark) {
  if (!isUsablePrice(price) || !isUsablePrice(benchmark)) return null;
  return ((price - benchmark) / benchmark) * 100;
}

/* Strictly *worse than* the threshold, so exactly 5.0% is not red. The
 * epsilon keeps float noise (e.g. 2.899 -> 3.04395) from tipping a value
 * that is mathematically exactly at the threshold. */
export function isOverThreshold(pct, threshold = THRESHOLD_PCT) {
  if (pct === null) return false;
  return pct > threshold + 1e-9;
}

/* Cents per gallon difference, which is how people actually talk about it. */
export function centsDiff(price, benchmark) {
  if (!isUsablePrice(price) || !isUsablePrice(benchmark)) return null;
  return (price - benchmark) * 100;
}

/* ---------------------------------------------------------------------------
 * evaluate(stations, priceData)
 *
 * `priceData` is the `stations` map out of data/prices.json, optionally with
 * manual overrides already merged in:
 *
 *   { wawa: { price: 3.059, observed: '<iso>', status: 'ok', source: '...' } }
 *
 * Returns one row per station, in station order, plus the benchmark price and
 * a headline verdict. Rendering does no arithmetic of its own.
 * ------------------------------------------------------------------------- */
export function evaluate(stations, priceData, threshold = THRESHOLD_PCT) {
  const data = priceData || {};

  const benchmarkStation = stations.find((s) => s.role === 'benchmark') || null;
  const benchmarkEntry = benchmarkStation ? data[benchmarkStation.id] : null;
  const benchmark = benchmarkEntry && isUsablePrice(benchmarkEntry.price)
    ? benchmarkEntry.price
    : null;

  const rows = stations.map((station) => {
    const entry = data[station.id] || {};
    const price = isUsablePrice(entry.price) ? entry.price : null;
    const isBenchmark = station.role === 'benchmark';

    const pct = isBenchmark ? null : pctDiff(price, benchmark);
    const cents = isBenchmark ? null : centsDiff(price, benchmark);
    const over = isOverThreshold(pct, threshold);

    return {
      station,
      price,
      /* 'ok' | 'stale' | 'unavailable' — 'manual' means the user typed it. */
      status: price === null ? 'unavailable' : (entry.status || 'ok'),
      manual: Boolean(entry.manual),
      observed: entry.observed || null,
      source: entry.source || null,
      note: entry.note || null,
      pct,
      cents,
      over,
      tone: tone({ price, benchmark, isBenchmark, over }),
      cheapest: false
    };
  });

  /* Mark the cheapest known price. Costco usually takes this, but it is
   * computed rather than assumed — that's the interesting day. */
  const priced = rows.filter((r) => r.price !== null);
  if (priced.length) {
    const min = Math.min(...priced.map((r) => r.price));
    priced.filter((r) => r.price === min).forEach((r) => { r.cheapest = true; });
  }

  return {
    rows,
    benchmark,
    benchmarkStation,
    threshold,
    verdict: verdict(rows, benchmark, threshold),
    updated: latestObserved(rows)
  };
}

/* Colour intent for a row.
 *   unknown   — no price, or no benchmark to compare against
 *   benchmark — the yardstick itself, never judged
 *   bad       — worse than the threshold
 *   good      — at or under the threshold
 */
function tone({ price, benchmark, isBenchmark, over }) {
  if (price === null) return 'unknown';
  if (isBenchmark) return 'benchmark';
  if (benchmark === null) return 'unknown';
  return over ? 'bad' : 'good';
}

/* ---------------------------------------------------------------------------
 * The headline. This is the one line worth reading, so it answers the actual
 * question — do I just fill up on the loop, or is it a Costco day?
 *
 * The threshold is applied to the preferred station too. It is preferred, not
 * exempt: the reason to know Wawa's number is to know when it has drifted far
 * enough that the detour pays. When it is under the line, the answer is
 * always "fill up on the loop" — that is what preferred means.
 * ------------------------------------------------------------------------- */
function verdict(rows, benchmark, threshold) {
  const pref = rows.find((r) => r.station.role === 'preferred');

  if (!pref || pref.price === null) {
    return { key: 'no-preferred', headline: 'No price for Wawa yet', detail: null };
  }
  if (benchmark === null) {
    return {
      key: 'no-benchmark',
      headline: `Wawa ${money(pref.price)}`,
      detail: 'No Costco price to compare against.'
    };
  }
  if (pref.price <= benchmark) {
    return {
      key: 'preferred-wins',
      headline: 'Fill up at Wawa',
      detail: `Cheaper than Costco, and it is on the loop.`
    };
  }
  if (!pref.over) {
    return {
      key: 'preferred-ok',
      headline: 'Fill up at Wawa',
      detail: `Only ${fmtCents(pref.cents)} over Costco — inside ${threshold}%.`
    };
  }
  return {
    key: 'costco-run',
    headline: 'Worth the Costco run',
    detail: `Wawa is ${fmtCents(pref.cents)} over Costco (${fmtPct(pref.pct)}).`
  };
}

function latestObserved(rows) {
  const times = rows
    .map((r) => r.observed)
    .filter(Boolean)
    .map((t) => Date.parse(t))
    .filter((n) => Number.isFinite(n));
  return times.length ? new Date(Math.max(...times)).toISOString() : null;
}

/* -- formatting ----------------------------------------------------------- */

/* Pump prices are quoted to a tenth of a cent, and that third digit is not
 * decoration — it is most of a cent a gallon. Keep it. */
export function money(p) {
  return isUsablePrice(p) ? `$${p.toFixed(3)}` : '—';
}

export function fmtPct(pct) {
  if (pct === null) return '—';
  const sign = pct > 0 ? '+' : pct < 0 ? '−' : '';
  return `${sign}${Math.abs(pct).toFixed(1)}%`;
}

export function fmtCents(cents) {
  if (cents === null) return '—';
  const rounded = Math.abs(cents);
  const unit = `${rounded.toFixed(1)}¢`;
  if (cents > 0) return `${unit} more`;
  if (cents < 0) return `${unit} less`;
  return 'the same';
}

/* "3 min ago" / "2 hr ago" / "Aug 9". Gas prices go stale fast, so age is
 * shown everywhere a price is. */
export function fmtAge(iso, now = Date.now()) {
  if (!iso) return 'never';
  const t = Date.parse(iso);
  if (!Number.isFinite(t)) return 'unknown';

  const mins = Math.floor((now - t) / 60000);
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins} min ago`;

  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs} hr ago`;

  const days = Math.floor(hrs / 24);
  if (days < 7) return `${days}d ago`;
  return new Date(t).toLocaleDateString([], { month: 'short', day: 'numeric' });
}

/* Past this age a fetched price is too old to trust as "current". */
export const STALE_AFTER_MS = 12 * 60 * 60 * 1000;

export function isStaleAge(iso, now = Date.now()) {
  if (!iso) return true;
  const t = Date.parse(iso);
  if (!Number.isFinite(t)) return true;
  return now - t > STALE_AFTER_MS;
}
