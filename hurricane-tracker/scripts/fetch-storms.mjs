#!/usr/bin/env node
/* ---------------------------------------------------------------------------
 * Cone — storm + outlook fetcher
 *
 * Runs in GitHub Actions (see .github/workflows/hurricane-tracker.yml) and
 * rewrites hurricane-tracker/data/current-storms.json and
 * hurricane-tracker/data/outlook-atlantic.json. Node built-ins only.
 *
 * WHY THIS IS SERVER-SIDE
 * NHC does not send CORS headers, so a browser fetch() from a GitHub Pages
 * origin is made and then thrown away unread. The fetch happens here, in CI,
 * and the committed JSON is what the page reads.
 *
 * TWO INDEPENDENT SOURCES, ISOLATED
 * CurrentStorms.json (named systems + designated invests) and the Atlantic
 * Tropical Weather Outlook (prose on disturbances that don't have a
 * CurrentStorms entry yet) are unrelated NHC products. One going down, or
 * changing shape, must not take out the other — each is fetched and written
 * independently, and a failure on one carries its *previous* committed file
 * forward rather than blanking it.
 * ------------------------------------------------------------------------- */

import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { isInRegionBox } from '../js/filter.js';
import { htmlToText, parseOutlook } from '../js/outlook.js';

const HERE = dirname(fileURLToPath(import.meta.url));
const DATA_DIR = join(HERE, '..', 'data');
const STORMS_FILE = join(DATA_DIR, 'current-storms.json');
const OUTLOOK_FILE = join(DATA_DIR, 'outlook-atlantic.json');

const CURRENT_STORMS_URL = 'https://www.nhc.noaa.gov/CurrentStorms.json';
const OUTLOOK_RSS_URL = 'https://www.nhc.noaa.gov/index-at.xml';

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

function shapeStorm(raw) {
  const lat = typeof raw.latitudeNumeric === 'number' ? raw.latitudeNumeric : toNumberOrNull(raw.latitudeNumeric);
  const lon = typeof raw.longitudeNumeric === 'number' ? raw.longitudeNumeric : toNumberOrNull(raw.longitudeNumeric);

  return {
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
    lastUpdate: raw.lastUpdate || null,
    inRegion: isInRegionBox(lat, lon),
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

/* -- Atlantic outlook RSS ----------------------------------------------------- */

async function fetchOutlookAreas() {
  const xml = await withRetry(() => get(OUTLOOK_RSS_URL, 'application/rss+xml,text/xml,*/*;q=0.8'));
  const match = xml.match(/<item>[\s\S]*?<description>\s*<!\[CDATA\[([\s\S]*?)\]\]>\s*<\/description>[\s\S]*?<\/item>/);
  if (!match) throw new Error('outlook RSS: no <item><description> CDATA block found');

  const pubDateMatch = xml.match(/<pubDate>([^<]+)<\/pubDate>/);
  const text = htmlToText(match[1]);
  return { areas: parseOutlook(text), issued: pubDateMatch ? new Date(pubDateMatch[1]).toISOString() : null };
}

/* -- main --------------------------------------------------------------------- */

async function main() {
  await mkdir(DATA_DIR, { recursive: true });
  const now = new Date().toISOString();
  let failures = 0;

  /* storms */
  const prevStorms = await readJsonIfExists(STORMS_FILE);
  try {
    const storms = await fetchCurrentStorms();
    const inRegionCount = storms.filter((s) => s.inRegion).length;
    await writeFile(STORMS_FILE, `${JSON.stringify({
      ok: true,
      error: null,
      updated: now,
      checkedAt: now,
      totalActive: storms.length,
      inRegionCount,
      storms
    }, null, 2)}\n`, 'utf8');
    console.log(`storms: ${storms.length} active (${inRegionCount} in region)`);
  } catch (err) {
    failures += 1;
    console.error(`storms: FAILED — ${err.message}`);
    const carried = prevStorms || {
      updated: null, totalActive: 0, inRegionCount: 0, storms: []
    };
    await writeFile(STORMS_FILE, `${JSON.stringify({
      ...carried,
      ok: false,
      error: err.message,
      checkedAt: now
    }, null, 2)}\n`, 'utf8');
  }

  /* outlook */
  const prevOutlook = await readJsonIfExists(OUTLOOK_FILE);
  try {
    const { areas, issued } = await fetchOutlookAreas();
    const inRegionCount = areas.filter((a) => a.inRegion).length;
    await writeFile(OUTLOOK_FILE, `${JSON.stringify({
      ok: true,
      error: null,
      updated: now,
      issued,
      checkedAt: now,
      totalAreas: areas.length,
      inRegionCount,
      areas
    }, null, 2)}\n`, 'utf8');
    console.log(`outlook: ${areas.length} disturbance(s) (${inRegionCount} in region)`);
  } catch (err) {
    failures += 1;
    console.error(`outlook: FAILED — ${err.message}`);
    const carried = prevOutlook || {
      updated: null, issued: null, totalAreas: 0, inRegionCount: 0, areas: []
    };
    await writeFile(OUTLOOK_FILE, `${JSON.stringify({
      ...carried,
      ok: false,
      error: err.message,
      checkedAt: now
    }, null, 2)}\n`, 'utf8');
  }

  if (failures > 0) process.exitCode = 1;
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
