#!/usr/bin/env node
/* ---------------------------------------------------------------------------
 * Cone — storm + outlook fetcher
 *
 * Runs in GitHub Actions (see .github/workflows/hurricane-tracker.yml) and
 * rewrites hurricane-tracker/data/current-storms.json,
 * hurricane-tracker/data/outlook-atlantic.json and
 * hurricane-tracker/data/outlook-pacific.json. Node built-ins only.
 *
 * WHY THIS IS SERVER-SIDE
 * NHC does not send CORS headers, so a browser fetch() from a GitHub Pages
 * origin is made and then thrown away unread. The fetch happens here, in CI,
 * and the committed JSON is what the page reads.
 *
 * THREE INDEPENDENT SOURCES, ISOLATED
 * CurrentStorms.json (named systems + designated invests), the Atlantic
 * Tropical Weather Outlook (prose on disturbances that don't have a
 * CurrentStorms entry yet) and the eastern Pacific outlook (the same, for
 * the other side of Central America) are unrelated NHC products. One going
 * down, or changing shape, must not take out the others — each is fetched
 * and written independently, and a failure on one carries its *previous*
 * committed file forward rather than blanking it.
 * ------------------------------------------------------------------------- */

import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import {
  isInRegionBox, stormBasin, isPacificSide, crossoverReason,
  matchRegionKeywords, matchPacificKeywords
} from '../js/filter.js';
import { htmlToText, parseOutlook } from '../js/outlook.js';

const HERE = dirname(fileURLToPath(import.meta.url));
const DATA_DIR = join(HERE, '..', 'data');
const STORMS_FILE = join(DATA_DIR, 'current-storms.json');
const OUTLOOK_FILE = join(DATA_DIR, 'outlook-atlantic.json');
const PACIFIC_FILE = join(DATA_DIR, 'outlook-pacific.json');

const CURRENT_STORMS_URL = 'https://www.nhc.noaa.gov/CurrentStorms.json';
const OUTLOOK_RSS_URL = 'https://www.nhc.noaa.gov/index-at.xml';
const PACIFIC_RSS_URL = 'https://www.nhc.noaa.gov/index-ep.xml';

const TIMEOUT_MS = 20000;
const RETRIES = 3;
const UA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) '
  + 'AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36';

/* -- fetch helpers ---------------------------------------------------------- */

async function get(url, accept) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    const res = await fetch(url, {
      signal: controller.signal,
      redirect: 'follow',
      headers: { 'User-Agent': UA, Accept: accept, 'Accept-Language': 'en-US,en;q=0.9' }
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return await res.text();
  } finally {
    clearTimeout(timer);
  }
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

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

async function readJsonIfExists(path) {
  try {
    return JSON.parse(await readFile(path, 'utf8'));
  } catch {
    return null;
  }
}

/* -- CurrentStorms.json ------------------------------------------------------ */

function toNumberOrNull(v) {
  const n = typeof v === 'number' ? v : parseFloat(v);
  return Number.isFinite(n) ? n : null;
}

/* NHC's units: `intensity` is knots, `movementSpeed` is mph (it matches the
 * "moving W at 12 mph" line of the public advisory). */
function shapeStorm(raw) {
  const lat = toNumberOrNull(raw.latitudeNumeric);
  const lon = toNumberOrNull(raw.longitudeNumeric);

  const storm = {
    id: raw.id || null,
    binNumber: raw.binNumber || null,
    name: raw.name || raw.binNumber || 'Unnamed system',
    classification: raw.classification || null,
    intensity: toNumberOrNull(raw.intensity),
    pressure: toNumberOrNull(raw.pressure),
    lat,
    lon,
    movementDir: toNumberOrNull(raw.movementDir),
    movementSpeed: toNumberOrNull(raw.movementSpeed),
    lastUpdate: raw.lastUpdate || null
  };

  /* A Pacific-side storm can sit inside REGION_BOX (its west edge is east of
   * Acapulco) without being anywhere near the Gulf. It's on the other coast:
   * out of `inRegion`, and onto the crossover watch instead if it isn't
   * simply heading west. */
  const pacificSide = isPacificSide(storm);
  const reason = crossoverReason(storm);

  return {
    ...storm,
    basin: stormBasin(storm),
    inRegion: isInRegionBox(lat, lon) && !pacificSide,
    pacificSide,
    crossoverWatch: reason !== null,
    crossoverReason: reason,
    links: {
      publicAdvisory: raw.publicAdvisory?.url || null,
      forecastDiscussion: raw.forecastDiscussion?.url || null,
      forecastGraphics: raw.forecastGraphics?.url || null,
      trackConeKmz: raw.trackCone?.kmzFile || null
    }
  };
}

async function fetchCurrentStorms() {
  const body = await withRetry(() => get(CURRENT_STORMS_URL, 'application/json,*/*;q=0.8'));
  const json = JSON.parse(body);
  const active = Array.isArray(json.activeStorms) ? json.activeStorms : [];
  return active.map(shapeStorm);
}

/* -- outlook RSS (both basins) --------------------------------------------------- */

async function fetchOutlookAreas(url, matcher) {
  const xml = await withRetry(() => get(url, 'application/rss+xml,text/xml,*/*;q=0.8'));
  const match = xml.match(/<item>[\s\S]*?<description>\s*<!\[CDATA\[([\s\S]*?)\]\]>\s*<\/description>[\s\S]*?<\/item>/);
  if (!match) throw new Error('outlook RSS: no <item><description> CDATA block found');

  const pubDateMatch = xml.match(/<pubDate>([^<]+)<\/pubDate>/);
  const text = htmlToText(match[1]);
  return { areas: parseOutlook(text, matcher), issued: pubDateMatch ? new Date(pubDateMatch[1]).toISOString() : null };
}

/* -- write helpers --------------------------------------------------------------- */

async function writeJson(path, payload) {
  await writeFile(path, `${JSON.stringify(payload, null, 2)}\n`, 'utf8');
}

/* One source, one try/catch: on failure the previous committed file is
 * carried forward with ok:false and the error, never blanked. Returns 1 on
 * failure so main() can tally. */
async function updateSource({ label, file, fetch: fetchIt, empty, now }) {
  const prev = await readJsonIfExists(file);
  try {
    const { summary, ...fresh } = await fetchIt();
    await writeJson(file, { ok: true, error: null, updated: now, checkedAt: now, ...fresh });
    console.log(`${label}: ${summary}`);
    return 0;
  } catch (err) {
    console.error(`${label}: FAILED — ${err.message}`);
    const carried = prev || { updated: null, ...empty };
    await writeJson(file, { ...carried, ok: false, error: err.message, checkedAt: now });
    return 1;
  }
}

/* -- main --------------------------------------------------------------------- */

async function main() {
  await mkdir(DATA_DIR, { recursive: true });
  const now = new Date().toISOString();
  let failures = 0;

  failures += await updateSource({
    label: 'storms',
    file: STORMS_FILE,
    now,
    empty: { totalActive: 0, inRegionCount: 0, crossoverWatchCount: 0, storms: [] },
    fetch: async () => {
      const storms = await fetchCurrentStorms();
      const inRegionCount = storms.filter((s) => s.inRegion).length;
      const crossoverWatchCount = storms.filter((s) => s.crossoverWatch).length;
      return {
        totalActive: storms.length,
        inRegionCount,
        crossoverWatchCount,
        storms,
        summary: `${storms.length} active (${inRegionCount} in region, ${crossoverWatchCount} on Pacific crossover watch)`
      };
    }
  });

  const outlookSource = (label, url, matcher, noun) => ({
    label,
    now,
    empty: { issued: null, totalAreas: 0, inRegionCount: 0, areas: [] },
    fetch: async () => {
      const { areas, issued } = await fetchOutlookAreas(url, matcher);
      const inRegionCount = areas.filter((a) => a.inRegion).length;
      return {
        issued,
        totalAreas: areas.length,
        inRegionCount,
        areas,
        summary: `${areas.length} disturbance(s) (${inRegionCount} ${noun})`
      };
    }
  });

  failures += await updateSource({ file: OUTLOOK_FILE, ...outlookSource('outlook', OUTLOOK_RSS_URL, matchRegionKeywords, 'in region') });
  failures += await updateSource({ file: PACIFIC_FILE, ...outlookSource('pacific', PACIFIC_RSS_URL, matchPacificKeywords, 'near Central America') });

  if (failures > 0) process.exitCode = 1;
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
