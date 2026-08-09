/* ---------------------------------------------------------------------------
 * Pump — the price store
 *
 * One job: produce the merged price map that compare.js evaluates. Three
 * inputs, in increasing order of authority:
 *
 *   1. data/prices.json   whatever the last CI fetch committed
 *   2. age                an 'ok' price older than STALE_AFTER_MS is not 'ok'
 *                         any more, no matter what the file claims
 *   3. localStorage       a price Aaron typed himself, which always wins
 *
 * (3) beating (1) is deliberate. If he is standing at the pump looking at the
 * sign, the sign is right and the scraper is wrong. Overrides are marked so
 * the UI can show where the number came from, and are individually clearable.
 * ------------------------------------------------------------------------- */

import { isUsablePrice, isStaleAge } from './compare.js';

const OVERRIDES_KEY = 'pump.overrides.v1';

/* -- data/prices.json ----------------------------------------------------- */

/* Cache-bust on every load. The service worker caches the app shell, and
 * GitHub Pages puts its own CDN in front of everything; without this, a phone
 * that has had the app open all week happily shows Tuesday's prices. The
 * shell is fine to cache — this file is exactly the one thing that is not. */
export async function loadPublished() {
  const url = `./data/prices.json?t=${Date.now()}`;
  const res = await fetch(url, { cache: 'no-store' });
  if (!res.ok) throw new Error(`prices.json: HTTP ${res.status}`);
  return res.json();
}

/* -- manual overrides ----------------------------------------------------- */

/* localStorage can throw (Safari private mode) or hold something another
 * version of the app wrote. A broken override must never take the app down —
 * worst case we ignore it and show the fetched prices. */
export function readOverrides() {
  try {
    const raw = localStorage.getItem(OVERRIDES_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== 'object') return {};

    const clean = {};
    for (const [id, entry] of Object.entries(parsed)) {
      if (entry && isUsablePrice(entry.price)) {
        clean[id] = { price: entry.price, observed: entry.observed || null };
      }
    }
    return clean;
  } catch {
    return {};
  }
}

function writeOverrides(all) {
  try {
    localStorage.setItem(OVERRIDES_KEY, JSON.stringify(all));
    return true;
  } catch {
    return false;
  }
}

export function setOverride(id, price, now = new Date()) {
  if (!isUsablePrice(price)) return false;
  const all = readOverrides();
  all[id] = { price, observed: now.toISOString() };
  return writeOverrides(all);
}

export function clearOverride(id) {
  const all = readOverrides();
  delete all[id];
  return writeOverrides(all);
}

export function clearAllOverrides() {
  return writeOverrides({});
}

export function hasOverrides() {
  return Object.keys(readOverrides()).length > 0;
}

/* -- the merge ------------------------------------------------------------ */

/* Returns the map compare.evaluate() wants: station id -> entry. */
export function mergePrices(published, overrides, now = Date.now()) {
  const base = (published && published.stations) || {};
  const merged = {};

  for (const [id, entry] of Object.entries(base)) {
    merged[id] = { ...entry };

    /* A price the file calls fresh, but which was observed half a day ago, is
     * stale whatever the file says. This is what makes a workflow that has
     * quietly stopped running visible in the UI instead of invisible. */
    if (merged[id].status === 'ok' && isStaleAge(merged[id].observed, now)) {
      merged[id].status = 'stale';
      merged[id].note = merged[id].note || 'No successful fetch in over 12 hours';
    }
  }

  for (const [id, entry] of Object.entries(overrides || {})) {
    merged[id] = {
      price: entry.price,
      observed: entry.observed,
      /* A typed price is trusted while it is fresh and demoted like any other
       * once it is old — a number from Monday is Monday's number regardless of
       * who wrote it down. */
      status: isStaleAge(entry.observed, now) ? 'stale' : 'ok',
      source: null,
      manual: true,
      note: null
    };
  }

  return merged;
}

/* Everything the app needs for one render, with the fetch failure folded in
 * rather than thrown: if prices.json cannot be loaded at all, the overrides
 * alone still produce a usable screen. */
export async function load(now = Date.now()) {
  const overrides = readOverrides();
  let published = null;
  let error = null;

  try {
    published = await loadPublished();
  } catch (err) {
    error = err && err.message ? err.message : String(err);
  }

  return {
    published,
    overrides,
    error,
    prices: mergePrices(published, overrides, now),
    updated: (published && published.updated) || null
  };
}
