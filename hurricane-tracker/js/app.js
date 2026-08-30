/* ---------------------------------------------------------------------------
 * Cone — app
 *
 * Reads top to bottom:
 *   1. elements + state
 *   2. status
 *   3. banner (the verdict)
 *   4. storm cards
 *   5. outlook cards
 *   6. meta + load/refresh
 *   7. service worker
 *
 * Region filtering already happened server-side (scripts/fetch-storms.mjs) —
 * every storm/area here already carries `inRegion`. This file only turns
 * already-decided data into DOM; classification/formation-chance labels and
 * tones come from js/filter.js so the vocabulary can't drift between here and
 * the fetcher.
 * ------------------------------------------------------------------------- */

import { classificationInfo, formationTone } from './filter.js';
import { fmtAge } from './format.js';
import { loadAll } from './store.js';

const els = {
  status: document.getElementById('status'),
  banner: document.getElementById('banner'),
  bannerHeadline: document.getElementById('banner-headline'),
  bannerDetail: document.getElementById('banner-detail'),
  stormsNote: document.getElementById('storms-note'),
  storms: document.getElementById('storms'),
  outlookNote: document.getElementById('outlook-note'),
  outlook: document.getElementById('outlook'),
  stormsUpdated: document.getElementById('storms-updated'),
  outlookUpdated: document.getElementById('outlook-updated'),
  refresh: document.getElementById('refresh'),
  dataError: document.getElementById('data-error')
};

const state = { storms: null, outlook: null };

/* -- 2. status --------------------------------------------------------------- */

function setStatus(kind, text) {
  els.status.className = `status status--${kind}`;
  els.status.textContent = text;
}

/* -- 3. banner ---------------------------------------------------------------- */

/* high(3) > medium(2) > low(1) > none(0) — mirrors the tone ladder used for
 * storm classification so "worst thing in the region" means the same thing
 * whether that worst thing is a storm or an outlook area. */
function formationRank(area) {
  const rank = { high: 3, medium: 2, low: 1 };
  const a = rank[area.formationChance48h?.category] || 0;
  const b = rank[area.formationChance7d?.category] || 0;
  return Math.max(a, b);
}

function computeBanner({ inStorms, inAreas, bothFailed }) {
  if (bothFailed) {
    return { tone: 'unknown', badge: '📡', headline: 'Could not load storm data', detail: 'Both data sources failed to load — check your connection and refresh.' };
  }

  if (inStorms.length > 0) {
    const worst = inStorms[0];
    const info = classificationInfo(worst.classification);
    const badge = { HU: '🌀', TS: '🌪️', STS: '🌪️', TD: '👀', STD: '👀', PTC: '🌫️' }[worst.classification] || '👀';
    const headline = info.tone === 'bad'
      ? `Hurricane in your regions: ${worst.name}`
      : info.tone === 'warn'
        ? `Tropical storm activity: ${worst.name}`
        : `Tracking ${worst.name} near your regions`;
    const detail = inStorms.length > 1 ? `+${inStorms.length - 1} more system(s) below` : null;
    return { tone: info.tone, badge, headline, detail };
  }

  if (inAreas.length > 0) {
    const sorted = [...inAreas].sort((a, b) => formationRank(b) - formationRank(a));
    const worst = sorted[0];
    const tone = formationTone(worst.formationChance7d?.category || worst.formationChance48h?.category);
    const headline = tone === 'bad'
      ? 'High chance of development in your regions'
      : tone === 'warn'
        ? 'Development possible in your regions'
        : 'Low-chance disturbance being watched';
    const detail = sorted.length > 1 ? `+${sorted.length - 1} more area(s) below` : null;
    return { tone, badge: '🌊', headline, detail };
  }

  return {
    tone: 'good',
    badge: '✅',
    headline: 'All quiet in your regions',
    detail: 'No active systems or outlook areas near Tampa, Texas, Florida, the Bahamas, or Honduras/the western Caribbean right now.'
  };
}

function renderBanner(banner) {
  els.banner.className = `banner banner--${banner.tone}`;
  els.bannerHeadline.textContent = `${banner.badge} ${banner.headline}`;
  els.bannerDetail.textContent = banner.detail || '';
  els.bannerDetail.classList.toggle('is-hidden', !banner.detail);
}

/* -- 4. storms --------------------------------------------------------------- */

function renderStorms(inStorms, allStorms) {
  els.stormsNote.textContent = allStorms.length ? `${inStorms.length} of ${allStorms.length} active worldwide` : '';

  if (inStorms.length === 0) {
    els.storms.replaceChildren(emptyRow('No active systems in your regions right now.'));
    return;
  }

  const sorted = [...inStorms].sort((a, b) => {
    const rankDiff = classificationInfo(b.classification).rank - classificationInfo(a.classification).rank;
    return rankDiff !== 0 ? rankDiff : (b.intensity || 0) - (a.intensity || 0);
  });

  els.storms.replaceChildren(...sorted.map(renderStormRow));
}

function renderStormRow(storm) {
  const info = classificationInfo(storm.classification);
  const href = storm.links?.publicAdvisory || storm.links?.forecastDiscussion || null;
  const meta = storm.intensity != null ? `${info.label} · ${storm.intensity} kt` : info.label;
  return rowEl({ tone: info.tone, name: storm.name, meta, href });
}

/* -- 5. outlook ---------------------------------------------------------------- */

const OUTLOOK_URL = 'https://www.nhc.noaa.gov/text/MIATWOAT.shtml';

function renderOutlook(inAreas, allAreas) {
  els.outlookNote.textContent = allAreas.length ? `${inAreas.length} of ${allAreas.length} disturbance(s) noted` : '';

  if (inAreas.length === 0) {
    els.outlook.replaceChildren(emptyRow('No disturbances being tracked in your regions right now.'));
    return;
  }

  const sorted = [...inAreas].sort((a, b) => formationRank(b) - formationRank(a));
  els.outlook.replaceChildren(...sorted.map(renderOutlookRow));
}

function renderOutlookRow(area) {
  const chance = area.formationChance7d || area.formationChance48h;
  const tone = formationTone(chance?.category);
  const meta = chance ? `${capitalize(chance.category)} chance · ${chance.percent}` : 'Formation chance unknown';
  return rowEl({ tone, name: area.area, meta, href: OUTLOOK_URL });
}

function capitalize(s) {
  return s ? s[0].toUpperCase() + s.slice(1) : s;
}

/* -- shared row -------------------------------------------------------------- */

/* One line: name, then the likelihood/severity that answers "how worried
 * should I be," the whole thing linking straight to the NOAA product. */
function rowEl({ tone, name, meta, href }) {
  const li = document.createElement('li');
  li.className = `row row--${tone}`;

  const a = document.createElement('a');
  a.className = 'row__link';
  if (href) {
    a.href = href;
    a.target = '_blank';
    a.rel = 'noopener';
  } else {
    a.setAttribute('aria-disabled', 'true');
  }

  const nameEl = document.createElement('span');
  nameEl.className = 'row__name';
  nameEl.textContent = name;

  const metaEl = document.createElement('span');
  metaEl.className = 'row__meta';
  metaEl.textContent = meta;

  a.append(nameEl, metaEl);
  li.append(a);
  return li;
}

function emptyRow(text) {
  const li = document.createElement('li');
  li.className = 'row row--empty';
  const span = document.createElement('span');
  span.className = 'row__empty-text';
  span.textContent = text;
  li.append(span);
  return li;
}

/* -- 6. meta + load/refresh ------------------------------------------------------- */

function renderMeta() {
  const { storms, outlook } = state;

  els.stormsUpdated.textContent = `Storms ${metaText(storms)}`;
  els.outlookUpdated.textContent = `Outlook ${metaText(outlook)}`;

  const errors = [storms?.error, outlook?.error].filter(Boolean);
  els.dataError.textContent = errors.length ? errors.join(' · ') : '';
  els.dataError.classList.toggle('is-hidden', errors.length === 0);
}

function metaText(source) {
  if (!source || !source.updated) return '— no data yet';
  const staleFlag = source.stale ? ' · stale' : '';
  return `${fmtAge(source.updated)}${staleFlag}`;
}

async function refresh() {
  setStatus('loading', 'loading');

  const { storms, outlook } = await loadAll();
  state.storms = storms;
  state.outlook = outlook;

  const inStorms = (storms.storms || []).filter((s) => s.inRegion);
  const inAreas = (outlook.areas || []).filter((a) => a.inRegion);
  const bothFailed = !!storms.loadFailed && !!outlook.loadFailed;

  renderBanner(computeBanner({ inStorms, inAreas, bothFailed }));
  renderStorms(inStorms, storms.storms || []);
  renderOutlook(inAreas, outlook.areas || []);
  renderMeta();

  if (bothFailed) setStatus('error', 'offline');
  else if (storms.loadFailed || outlook.loadFailed || storms.stale || outlook.stale) setStatus('warn', 'partial');
  else setStatus('ok', 'ready');
}

els.refresh.addEventListener('click', refresh);

/* Coming back to a home-screen app after a day shouldn't show yesterday's
 * storm positions just because the tab was never closed. */
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'visible') refresh();
});

refresh();

/* -- 7. service worker -------------------------------------------------------------- */

if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('./sw.js').catch(() => {
      /* No offline shell; the app still works online. Not worth a message. */
    });
  });
}
