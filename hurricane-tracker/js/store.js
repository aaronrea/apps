/* ---------------------------------------------------------------------------
 * Cone — data loading
 *
 * Reads the two files scripts/fetch-storms.mjs commits: data/current-
 * storms.json and data/outlook-atlantic.json. They fail independently at the
 * source (see the fetcher's header comment), so they're loaded independently
 * here too — a broken outlook fetch should never blank out a real storm.
 * ------------------------------------------------------------------------- */

import { isStaleAge } from './format.js';

async function loadJson(path) {
  // Cache-bust: the service worker and GitHub Pages' own CDN would otherwise
  // happily keep serving last week's data to an app that's been open all week.
  const url = `${path}?t=${Date.now()}`;
  const res = await fetch(url, { cache: 'no-store' });
  if (!res.ok) throw new Error(`${path}: HTTP ${res.status}`);
  return res.json();
}

/* A source whose own `ok` flag is false already carried its previous data
 * forward (see the fetcher) — but re-check age here too, so a workflow that
 * has quietly stopped running goes stale in the UI even if it never fails
 * outright. */
function withFreshness(payload, now) {
  const stale = payload.ok === false || isStaleAge(payload.updated, now);
  return { ...payload, stale };
}

export async function loadStorms(now = Date.now()) {
  try {
    return withFreshness(await loadJson('./data/current-storms.json'), now);
  } catch (err) {
    return { ok: false, error: err.message, updated: null, storms: [], totalActive: 0, inRegionCount: 0, stale: true, loadFailed: true };
  }
}

export async function loadOutlook(now = Date.now()) {
  try {
    return withFreshness(await loadJson('./data/outlook-atlantic.json'), now);
  } catch (err) {
    return { ok: false, error: err.message, updated: null, areas: [], totalAreas: 0, inRegionCount: 0, stale: true, loadFailed: true };
  }
}

export async function loadAll(now = Date.now()) {
  const [storms, outlook] = await Promise.all([loadStorms(now), loadOutlook(now)]);
  return { storms, outlook };
}
