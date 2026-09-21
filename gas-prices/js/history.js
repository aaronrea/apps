/* ---------------------------------------------------------------------------
 * Pump — price history and direction
 *
 * Pure functions, no DOM, no fetch — same contract as compare.js, and covered
 * by the same test file. Two halves that never run in the same process:
 *
 *   recordDay()  runs in CI, inside the fetcher, and decides what goes into
 *                the `history` array in data/prices.json.
 *   trendFor()   runs in the browser, and turns that array into "9¢ cheaper
 *                than yesterday" for one station.
 *
 * WHY A DAY AND NOT A RUN
 * The workflow fetches every two hours, so run-to-run differences are mostly
 * the same number twelve times over. A station that moved 3¢ between the
 * morning and evening runs has moved 3¢ today, not 3¢ six times. Bucketing
 * by calendar day — Bradenton's, not UTC's — is what makes "since yesterday"
 * mean anything.
 *
 * THE ONE RULE, STILL
 * The fetcher never writes a number it did not read from a source, and this
 * inherits that: only a status of 'ok' is ever recorded. A carried-forward
 * `stale` price is the *previous* day's observation wearing today's date, and
 * writing it would manufacture a flat line out of a broken scraper — exactly
 * the lie the rest of the app goes out of its way not to tell. A day we could
 * not fetch gets no entry, and the gap is visible as a longer baseline.
 * ------------------------------------------------------------------------- */

import { isUsablePrice } from './compare.js';

/* A week is enough to see a direction and short enough that the file stays
 * small and its diffs stay readable. Nothing here is a chart. */
export const HISTORY_DAYS = 7;

/* Below this, a difference is float noise rather than a price move: pump
 * prices are quoted in tenths of a cent, so the smallest real step is 0.1¢. */
const FLAT_EPSILON_CENTS = 0.05;

/* -- dates ---------------------------------------------------------------- */

/* The four stations are all in one town, so "what day is it" has one answer
 * and it is not UTC's. The workflow runs every two hours, which means the
 * 00:43 and 02:43 UTC runs are 8:43pm and 10:43pm the *previous* evening in
 * Bradenton: bucketing those on the UTC date would file last night's price
 * under tomorrow and quietly shift the day boundary to 8pm. */
const ZONE = 'America/New_York';

/* Built once — constructing a DateTimeFormat per call is the expensive part,
 * and this runs for every station on every render. */
const DAY_FMT = new Intl.DateTimeFormat('en-US', {
  timeZone: ZONE, year: 'numeric', month: '2-digit', day: '2-digit'
});

/* The calendar day an observation belongs to in Bradenton, as YYYY-MM-DD.
 *
 * Assembled from parts rather than from a locale's own date string, because
 * what a locale hands back is a formatting decision that can change; the part
 * names cannot. */
export function dayOf(iso) {
  if (!iso) return null;
  const t = Date.parse(iso);
  if (!Number.isFinite(t)) return null;

  const parts = {};
  for (const { type, value } of DAY_FMT.formatToParts(new Date(t))) parts[type] = value;
  if (!parts.year || !parts.month || !parts.day) return null;

  return `${parts.year}-${parts.month}-${parts.day}`;
}

/* Whole days between two YYYY-MM-DD keys. The keys are already local calendar
 * days, so they are parsed as UTC midnight purely to subtract them — that way
 * the spring-forward day is still one day long rather than 23 hours. */
export function daysBetween(from, to) {
  const a = Date.parse(`${from}T00:00:00Z`);
  const b = Date.parse(`${to}T00:00:00Z`);
  if (!Number.isFinite(a) || !Number.isFinite(b)) return null;
  return Math.round((b - a) / 86400000);
}

/* -- writing (CI) --------------------------------------------------------- */

/* Fold this run's prices into the history array and return the new one.
 *
 * Idempotent within a day: the second and third runs overwrite the first for
 * the same date, so a day's recorded price is the last one actually observed
 * that day. Days are keyed off each station's own `observed` stamp rather
 * than the time CI happened to run — 7-Eleven publishes when it last set the
 * price, and a price stamped yesterday morning is yesterday's number even if
 * we read it today.
 */
export function recordDay(history, stations, fallbackIso) {
  const days = new Map();

  for (const entry of Array.isArray(history) ? history : []) {
    if (!entry || typeof entry.date !== 'string' || !entry.prices) continue;

    const clean = {};
    for (const [id, price] of Object.entries(entry.prices)) {
      if (isUsablePrice(price)) clean[id] = price;
    }
    days.set(entry.date, clean);
  }

  for (const [id, entry] of Object.entries(stations || {})) {
    /* 'stale' is a carry-forward and 'unavailable' is nothing at all. Neither
     * is an observation, so neither is recorded. */
    if (!entry || entry.status !== 'ok' || !isUsablePrice(entry.price)) continue;

    const date = dayOf(entry.observed) || dayOf(fallbackIso);
    if (!date) continue;

    const bucket = days.get(date) || {};
    bucket[id] = entry.price;
    days.set(date, bucket);
  }

  return [...days.entries()]
    .filter(([date, prices]) => date && Object.keys(prices).length > 0)
    .sort((a, b) => (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0))
    .slice(-HISTORY_DAYS)
    .map(([date, prices]) => ({ date, prices }));
}

/* -- reading (browser) ---------------------------------------------------- */

/* One station's recorded prices, oldest first. */
export function seriesFor(history, id) {
  return (Array.isArray(history) ? history : [])
    .filter((e) => e && typeof e.date === 'string' && e.prices && isUsablePrice(e.prices[id]))
    .map((e) => ({ date: e.date, price: e.prices[id] }))
    .sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));
}

function direction(cents) {
  if (Math.abs(cents) < FLAT_EPSILON_CENTS) return 'flat';
  return cents > 0 ? 'up' : 'down';
}

/* ---------------------------------------------------------------------------
 * trendFor(history, id, row)
 *
 * `row` is a row out of compare.evaluate() — it needs the price, the status
 * and the observation time. Returns null whenever there is nothing honest to
 * say, which the UI renders as nothing at all rather than as "no data".
 *
 * The baseline is the most recent recorded day *strictly before* the day this
 * price was observed. Usually that is yesterday; after a run of failed fetches
 * it is further back, and the caller is told how far so it can say so instead
 * of calling three days "yesterday".
 * ------------------------------------------------------------------------- */
export function trendFor(history, id, row, now = Date.now()) {
  if (!row || !isUsablePrice(row.price)) return null;

  /* A stale price IS the old price. Comparing it against the day we last saw
   * it would report "unchanged" when the honest answer is that we don't know
   * what it is now. */
  if (row.status === 'stale') return null;

  const asOf = dayOf(row.observed) || dayOf(new Date(now).toISOString());
  if (!asOf) return null;

  const series = seriesFor(history, id).filter((p) => p.date < asOf);
  if (!series.length) return null;

  const prev = series[series.length - 1];
  const before = series.length > 1 ? series[series.length - 2] : null;

  const cents = (row.price - prev.price) * 100;
  const dir = direction(cents);

  /* The question this whole feature exists to answer: was it going one way and
   * is it now going the other? A flat step is a quiet day, not a turn, so it
   * breaks the comparison rather than counting as a reversal. */
  const priorDir = before ? direction((prev.price - before.price) * 100) : null;
  const turned = Boolean(
    priorDir && priorDir !== 'flat' && dir !== 'flat' && priorDir !== dir
  );

  return { from: prev.price, since: prev.date, days: daysBetween(prev.date, asOf), cents, direction: dir, turned };
}

/* -- formatting ----------------------------------------------------------- */

/* "Sep 19". The key is already a Bradenton calendar day, so it is formatted
 * back in UTC to print the day it names. Without the explicit zone, a
 * YYYY-MM-DD string parses as UTC midnight and then formats in local time,
 * which shows the previous day everywhere west of Greenwich — including,
 * pointedly, Florida. */
export function fmtDay(date) {
  const t = Date.parse(`${date}T00:00:00Z`);
  if (!Number.isFinite(t)) return date;
  return new Date(t).toLocaleDateString([], { month: 'short', day: 'numeric', timeZone: 'UTC' });
}

/* One line, right-aligned under the price. Deliberately text and glyphs only:
 * red / amber / green are load-bearing in this app (over the line, make the
 * trip, fill up) and a cheaper price rendered in green would read as a verdict
 * rather than as a direction. */
export function fmtTrend(trend) {
  if (!trend) return '';

  const glyph = { up: '▲', down: '▼', flat: '▬' }[trend.direction] || '';
  const size = trend.direction === 'flat' ? 'flat' : `${Math.abs(trend.cents).toFixed(1)}¢`;
  const when = trend.days === 1 ? 'since yesterday' : `since ${fmtDay(trend.since)}`;
  const turn = trend.turned ? ` · turned ${trend.direction}` : '';

  return `${glyph} ${size} ${when}${turn}`;
}
