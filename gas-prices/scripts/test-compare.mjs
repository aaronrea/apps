#!/usr/bin/env node
/* ---------------------------------------------------------------------------
 * Pump — tests for the comparison logic
 *
 * No framework, no dependencies: node scripts/test-compare.mjs
 *
 * compare.js is the only part of this app where being wrong is expensive — a
 * bad render is obvious, a bad threshold silently sends you to Costco for
 * nothing (or doesn't send you when it should). So the cases that matter are
 * the boundary, the missing benchmark, and the empty state.
 * ------------------------------------------------------------------------- */

import { STATIONS, THRESHOLD_PCT } from '../js/stations.js';
import {
  evaluate, pctDiff, centsDiff, isOverThreshold, isUsablePrice,
  money, fmtPct, fmtPctNear, fmtCents, fmtCentsAbs, fmtAge, isStaleAge, STALE_AFTER_MS
} from '../js/compare.js';
import { mergePrices } from '../js/store.js';

let passed = 0;
const failures = [];

function check(name, fn) {
  try {
    fn();
    passed += 1;
  } catch (err) {
    failures.push(`${name}\n    ${err.message}`);
  }
}

function eq(actual, expected, what = '') {
  const a = JSON.stringify(actual);
  const e = JSON.stringify(expected);
  if (a !== e) throw new Error(`${what}expected ${e}, got ${a}`);
}

function close(actual, expected, tol = 1e-9) {
  if (actual === null || Math.abs(actual - expected) > tol) {
    throw new Error(`expected ~${expected}, got ${actual}`);
  }
}

/* Build a price map for the four station ids. */
function prices(map) {
  const out = {};
  for (const [id, price] of Object.entries(map)) {
    out[id] = price === null
      ? { price: null, status: 'unavailable', observed: null }
      : { price, status: 'ok', observed: new Date().toISOString() };
  }
  return out;
}

/* -- price validity ------------------------------------------------------- */

check('isUsablePrice rejects everything that is not a positive finite number', () => {
  eq(isUsablePrice(3.199), true);
  eq(isUsablePrice(0), false, '0 is not a price: ');
  eq(isUsablePrice(-1), false);
  eq(isUsablePrice(null), false);
  eq(isUsablePrice(undefined), false);
  eq(isUsablePrice(NaN), false);
  eq(isUsablePrice('3.199'), false, 'a string is not a price: ');
  eq(isUsablePrice(Infinity), false);
});

/* -- the percentage math -------------------------------------------------- */

check('pctDiff is signed, benchmark-relative', () => {
  close(pctDiff(3.30, 3.00), 10);
  close(pctDiff(3.00, 3.00), 0);
  close(pctDiff(2.70, 3.00), -10);
});

check('pctDiff is null when either side is unknown', () => {
  eq(pctDiff(null, 3.00), null);
  eq(pctDiff(3.00, null), null);
  eq(pctDiff(null, null), null);
});

check('centsDiff reports cents per gallon', () => {
  close(centsDiff(3.199, 2.999), 20, 1e-9);
  close(centsDiff(2.999, 3.199), -20, 1e-9);
  eq(centsDiff(3.199, null), null);
});

/* -- the threshold, which is the whole point ------------------------------ */

check('the threshold is strictly greater-than: exactly 5.0% is NOT over', () => {
  eq(isOverThreshold(5), false, 'exactly at the line: ');
  /* Real float noise off the division is ~4e-15 (see the case below), so the
   * 1e-9 epsilon swallows it with room to spare — while a value that is
   * genuinely over, rather than noisily over, still counts. */
  eq(isOverThreshold(5 + 4e-15), false, 'float noise must not tip it: ');
  eq(isOverThreshold(5.0000001), true, 'meaningfully over is over: ');
  eq(isOverThreshold(4.99), false);
  eq(isOverThreshold(5.01), true);
  eq(isOverThreshold(0), false);
  eq(isOverThreshold(-10), false, 'cheaper is never over: ');
  eq(isOverThreshold(null), false, 'unknown is not over: ');
});

check('a price computed to land exactly on 5% is not flagged', () => {
  /* 3.00 * 1.05 = 3.15 exactly, the case the epsilon exists for: the division
   * actually yields 4.999999999999996, and 2.10 against 2.00 yields
   * 5.000000000000004 — landing on either side of the line by ~4e-15. */
  const benchmark = 3.00;
  const at = 3.15;
  close(pctDiff(at, benchmark), 5);
  eq(isOverThreshold(pctDiff(at, benchmark)), false, 'exactly 5%, low side: ');
  eq(isOverThreshold(pctDiff(2.10, 2.00)), false, 'exactly 5%, high side: ');

  /* One tenth of a cent past the line is over. */
  eq(isOverThreshold(pctDiff(3.151, benchmark)), true, 'a hair past 5%: ');
});

check('the threshold applies to the preferred station too', () => {
  const over = evaluate(STATIONS, prices({
    wawa: 3.16, costco: 3.00, racetrac: 3.00, '7-eleven': 3.00
  }));
  eq(over.verdict.key, 'costco-run', 'Wawa 5.33% over: ');

  const under = evaluate(STATIONS, prices({
    wawa: 3.15, costco: 3.00, racetrac: 3.00, '7-eleven': 3.00
  }));
  eq(under.verdict.key, 'preferred-ok', 'Wawa exactly 5% over: ');
  eq(under.verdict.headline, 'Fill up at Wawa');
});

/* -- evaluate() ----------------------------------------------------------- */

check('evaluate returns one row per station, in station order', () => {
  const out = evaluate(STATIONS, prices({
    wawa: 3.05, costco: 2.99, racetrac: 3.09, '7-eleven': 3.29
  }));
  eq(out.rows.length, 4);
  eq(out.rows.map((r) => r.station.id), ['wawa', 'costco', 'racetrac', '7-eleven']);
  eq(out.benchmark, 2.99);
});

check('the benchmark row is never judged against itself', () => {
  const out = evaluate(STATIONS, prices({
    wawa: 3.05, costco: 2.99, racetrac: 3.09, '7-eleven': 3.29
  }));
  const costco = out.rows.find((r) => r.station.id === 'costco');
  eq(costco.pct, null);
  eq(costco.cents, null);
  eq(costco.over, false);
  eq(costco.tone, 'benchmark');
});

check('tones follow the threshold', () => {
  const out = evaluate(STATIONS, prices({
    wawa: 3.05, costco: 3.00, racetrac: 3.14, '7-eleven': 3.30
  }));
  const tone = (id) => out.rows.find((r) => r.station.id === id).tone;
  eq(tone('wawa'), 'good', 'wawa 1.67% over: ');
  eq(tone('racetrac'), 'good', 'racetrac 4.67% over: ');
  eq(tone('7-eleven'), 'bad', '7-eleven 10% over: ');
});

check('the cheapest station is computed, not assumed to be Costco', () => {
  const out = evaluate(STATIONS, prices({
    wawa: 2.95, costco: 3.00, racetrac: 3.09, '7-eleven': 3.29
  }));
  eq(out.rows.filter((r) => r.cheapest).map((r) => r.station.id), ['wawa']);
  eq(out.verdict.key, 'preferred-wins', 'Wawa under Costco: ');
});

check('a tie marks every station holding the low price', () => {
  const out = evaluate(STATIONS, prices({
    wawa: 3.00, costco: 3.00, racetrac: 3.50, '7-eleven': 3.50
  }));
  eq(out.rows.filter((r) => r.cheapest).map((r) => r.station.id), ['wawa', 'costco']);
});

/* -- the degenerate states ------------------------------------------------ */

check('a missing benchmark leaves every comparison unknown, and says so', () => {
  const out = evaluate(STATIONS, prices({
    wawa: 3.05, costco: null, racetrac: 3.09, '7-eleven': 3.29
  }));
  eq(out.benchmark, null);
  for (const row of out.rows.filter((r) => r.station.role !== 'benchmark')) {
    eq(row.pct, null, `${row.station.id} pct: `);
    eq(row.over, false, `${row.station.id} over: `);
    eq(row.tone, 'unknown', `${row.station.id} tone: `);
  }
  eq(out.verdict.key, 'no-benchmark');
  /* Wawa's own price is still known and still worth showing. */
  eq(out.verdict.headline, 'Wawa $3.050');
});

check('no prices at all renders nothing rather than guessing', () => {
  const out = evaluate(STATIONS, prices({
    wawa: null, costco: null, racetrac: null, '7-eleven': null
  }));
  eq(out.benchmark, null);
  eq(out.updated, null);
  eq(out.rows.every((r) => r.price === null), true);
  eq(out.rows.every((r) => r.status === 'unavailable'), true);
  eq(out.rows.some((r) => r.cheapest), false, 'nothing is cheapest: ');
  eq(out.verdict.key, 'no-preferred');
});

check('an empty price map is survivable', () => {
  const out = evaluate(STATIONS, {});
  eq(out.rows.length, 4);
  eq(out.verdict.key, 'no-preferred');
  eq(evaluate(STATIONS, null).rows.length, 4, 'null price map: ');
  eq(evaluate(STATIONS, undefined).rows.length, 4, 'undefined price map: ');
});

check('a missing Wawa price does not stop the other rows comparing', () => {
  const out = evaluate(STATIONS, prices({
    wawa: null, costco: 3.00, racetrac: 3.30, '7-eleven': 3.05
  }));
  eq(out.verdict.key, 'no-preferred');
  eq(out.benchmark, 3.00);
  eq(out.rows.find((r) => r.station.id === 'racetrac').tone, 'bad', 'racetrac 10% over: ');
  eq(out.rows.find((r) => r.station.id === '7-eleven').tone, 'good');
});

check('Costco not actually being cheapest still reads correctly', () => {
  const out = evaluate(STATIONS, prices({
    wawa: 3.00, costco: 3.30, racetrac: 3.10, '7-eleven': 3.20
  }));
  const rt = out.rows.find((r) => r.station.id === 'racetrac');
  close(rt.pct, -6.0606060606, 1e-6);
  eq(rt.over, false, 'cheaper than benchmark is never red: ');
  eq(out.rows.filter((r) => r.cheapest).map((r) => r.station.id), ['wawa']);
});

/* -- formatting ----------------------------------------------------------- */

check('prices keep the third decimal, because that is most of a cent', () => {
  eq(money(3.199), '$3.199');
  eq(money(3.2), '$3.200');
  eq(money(null), '—');
  eq(money(0), '—');
});

check('percentages and cents are signed and human', () => {
  eq(fmtPct(3.24), '+3.2%');
  eq(fmtPct(-3.24), '−3.2%');
  eq(fmtPct(0), '0.0%');
  eq(fmtPct(null), '—');

  eq(fmtCents(12), '12.0¢ more');
  eq(fmtCents(-12), '12.0¢ less');
  eq(fmtCents(0), 'the same');
  eq(fmtCents(null), '—');

  /* The bare magnitude, for sentences that bring their own preposition. */
  eq(fmtCentsAbs(12), '12.0¢');
  eq(fmtCentsAbs(-12), '12.0¢');
  eq(fmtCentsAbs(null), '—');
});

check('a row near the threshold does not round to a self-contradiction', () => {
  /* 3.884 against 3.699 is 5.0014% — genuinely over, but "+5.0%" at one
   * decimal would read as exactly on the line while being flagged red. */
  const pct = pctDiff(3.884, 3.699);
  eq(isOverThreshold(pct), true);
  eq(fmtPct(pct), '+5.0%', 'the plain formatter does round: ');
  eq(fmtPctNear(pct), '+5.001%', 'the near-threshold one does not: ');

  /* Just under the line reads distinctly under it. */
  eq(fmtPctNear(pctDiff(3.8839, 3.699)), '+4.999%');

  /* Away from the threshold it stays at one decimal. */
  eq(fmtPctNear(3.2441), '+3.2%');
  eq(fmtPctNear(10.8), '+10.8%');
  eq(fmtPctNear(null), '—');
});

check('the verdict detail does not double up its preposition', () => {
  const ok = evaluate(STATIONS, prices({
    wawa: 3.819, costco: 3.699, racetrac: 3.769, '7-eleven': null
  }));
  eq(ok.verdict.detail, 'Only 12.0¢ over Costco — inside 5%.');

  const run = evaluate(STATIONS, prices({
    wawa: 3.90, costco: 3.699, racetrac: 3.769, '7-eleven': null
  }));
  eq(run.verdict.detail, 'Wawa is 20.1¢ over Costco (+5.4%).');
});

check('ages read the way people say them', () => {
  const now = Date.parse('2026-08-09T12:00:00Z');
  const ago = (ms) => new Date(now - ms).toISOString();
  eq(fmtAge(ago(30 * 1000), now), 'just now');
  eq(fmtAge(ago(5 * 60000), now), '5 min ago');
  eq(fmtAge(ago(3 * 3600000), now), '3 hr ago');
  eq(fmtAge(ago(50 * 3600000), now), '2d ago');
  eq(fmtAge(null, now), 'never');
  eq(fmtAge('not a date', now), 'unknown');
});

/* -- staleness ------------------------------------------------------------ */

check('staleness kicks in past 12 hours', () => {
  const now = Date.parse('2026-08-09T12:00:00Z');
  const ago = (ms) => new Date(now - ms).toISOString();
  eq(isStaleAge(ago(STALE_AFTER_MS - 60000), now), false, 'just inside: ');
  eq(isStaleAge(ago(STALE_AFTER_MS + 60000), now), true, 'just outside: ');
  eq(isStaleAge(null, now), true, 'never observed is stale: ');
});

/* -- the merge ------------------------------------------------------------ */

check('a manual override beats the fetched price and is marked manual', () => {
  const now = Date.now();
  const published = {
    stations: {
      wawa: { price: 3.819, status: 'ok', observed: new Date(now).toISOString(), source: 'x' }
    }
  };
  const merged = mergePrices(published, { wawa: { price: 3.50, observed: new Date(now).toISOString() } }, now);
  eq(merged.wawa.price, 3.50);
  eq(merged.wawa.manual, true);
  eq(merged.wawa.status, 'ok');
});

check('an ok price older than 12h is downgraded to stale on load', () => {
  const now = Date.now();
  const old = new Date(now - STALE_AFTER_MS - 60000).toISOString();
  const merged = mergePrices({ stations: { costco: { price: 3.00, status: 'ok', observed: old } } }, {}, now);
  eq(merged.costco.status, 'stale');
  eq(merged.costco.price, 3.00, 'the price itself is kept: ');
});

check('a stale override is demoted like any other old price', () => {
  const now = Date.now();
  const old = new Date(now - STALE_AFTER_MS - 60000).toISOString();
  const merged = mergePrices({ stations: {} }, { wawa: { price: 3.50, observed: old } }, now);
  eq(merged.wawa.status, 'stale');
  eq(merged.wawa.manual, true);
});

/* -- the real numbers ----------------------------------------------------- */

check('the live prices fetched on 2026-08-09 land under the line', () => {
  /* Wawa 3.819 vs Costco 3.699 is +3.24%: preferred, inside 5%, so the answer
   * is the loop. This is the case the app exists to answer. */
  const out = evaluate(STATIONS, prices({
    wawa: 3.819, costco: 3.699, racetrac: 3.769, '7-eleven': null
  }));
  close(out.rows.find((r) => r.station.id === 'wawa').pct, 3.2441200324, 1e-6);
  eq(out.verdict.key, 'preferred-ok');
  eq(out.verdict.headline, 'Fill up at Wawa');
  eq(out.rows.find((r) => r.station.id === 'racetrac').tone, 'good');
  eq(out.rows.find((r) => r.station.id === '7-eleven').status, 'unavailable');
  eq(out.rows.filter((r) => r.cheapest).map((r) => r.station.id), ['costco']);
});

/* -- config sanity -------------------------------------------------------- */

check('there is exactly one benchmark and one preferred station', () => {
  eq(STATIONS.filter((s) => s.role === 'benchmark').length, 1);
  eq(STATIONS.filter((s) => s.role === 'preferred').length, 1);
  eq(THRESHOLD_PCT, 5);
  eq(new Set(STATIONS.map((s) => s.id)).size, STATIONS.length, 'ids are unique: ');
});

/* -- report --------------------------------------------------------------- */

if (failures.length) {
  console.error(`\n${failures.length} failed, ${passed} passed\n`);
  for (const f of failures) console.error(`  ✗ ${f}\n`);
  process.exit(1);
}
console.log(`${passed} checks passed`);
