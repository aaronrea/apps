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

import { classificationInfo, ktToMph, formationTone } from './filter.js';
import { fmtWind, fmtPressure, fmtMovement, fmtCoords, fmtAge } from './format.js';
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
    const names = inStorms.map((s) => `${s.name} (${classificationInfo(s.classification).label})`).join(', ');
    const badge = { HU: '🌀', TS: '🌪️', STS: '🌪️', TD: '👀', STD: '👀', PTC: '🌫️' }[worst.classification] || '👀';
    const headline = info.tone === 'bad'
      ? `Hurricane in your regions: ${worst.name}`
      : info.tone === 'warn'
        ? `Tropical storm activity: ${worst.name}`
        : `Tracking ${worst.name} near your regions`;
    return { tone: info.tone, badge, headline, detail: names };
  }

  if (inAreas.length > 0) {
    const sorted = [...inAreas].sort((a, b) => formationRank(b) - formationRank(a));
    const worst = sorted[0];
    const tone = formationTone(worst.formationChance7d?.category || worst.formationChance48h?.category);
    const detail = sorted
      .map((a) => `${a.area} — ${a.formationChance7d?.category || 'low'} chance (${a.formationChance7d?.percent || 'n/a'} in 7 days)`)
      .join('; ');
    const headline = tone === 'bad'
      ? 'High chance of development in your regions'
      : tone === 'warn'
        ? 'Development possible in your regions'
        : 'Low-chance disturbance being watched';
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

/* -- 4. storm cards ------------------------------------------------------------ */

function renderStorms(inStorms, allStorms) {
  els.stormsNote.textContent = allStorms.length
    ? `${allStorms.length} active worldwide · ${inStorms.length} in your regions`
    : '';

  if (inStorms.length === 0) {
    els.storms.replaceChildren(emptyCard('No active systems in your regions right now.'));
    return;
  }

  const sorted = [...inStorms].sort((a, b) => {
    const rankDiff = classificationInfo(b.classification).rank - classificationInfo(a.classification).rank;
    return rankDiff !== 0 ? rankDiff : (b.intensity || 0) - (a.intensity || 0);
  });

  els.storms.replaceChildren(...sorted.map(renderStormCard));
}

function renderStormCard(storm) {
  const info = classificationInfo(storm.classification);
  const mph = ktToMph(storm.intensity);

  const li = document.createElement('li');
  li.className = `card card--${info.tone}`;

  const head = document.createElement('div');
  head.className = 'card__head';

  const badge = document.createElement('span');
  badge.className = `badge badge--${info.tone}`;
  badge.textContent = info.label;

  const name = document.createElement('p');
  name.className = 'card__name';
  name.textContent = storm.name;
  if (storm.binNumber) {
    const bin = document.createElement('span');
    bin.className = 'card__subtle';
    bin.textContent = ` (${storm.binNumber})`;
    name.append(bin);
  }

  head.append(badge, name);
  li.append(head);

  const stats = document.createElement('div');
  stats.className = 'card__stats';
  [
    fmtWind(storm.intensity, mph),
    fmtPressure(storm.pressure),
    fmtMovement(storm.movementDir, storm.movementSpeed),
    fmtCoords(storm.lat, storm.lon)
  ].filter(Boolean).forEach((text) => {
    const p = document.createElement('span');
    p.className = 'card__stat';
    p.textContent = text;
    stats.append(p);
  });
  li.append(stats);

  const foot = document.createElement('div');
  foot.className = 'card__foot';

  const age = document.createElement('span');
  age.className = 'card__age';
  age.textContent = storm.lastUpdate ? `Updated ${fmtAge(storm.lastUpdate)}` : '';
  foot.append(age);

  const links = document.createElement('span');
  links.className = 'card__links';
  if (storm.links?.publicAdvisory) links.append(linkEl('Advisory', storm.links.publicAdvisory));
  if (storm.links?.forecastDiscussion) links.append(linkEl('Discussion', storm.links.forecastDiscussion));
  foot.append(links);

  li.append(foot);
  return li;
}

/* -- 5. outlook cards ----------------------------------------------------------- */

const OUTLOOK_URL = 'https://www.nhc.noaa.gov/text/MIATWOAT.shtml';

function renderOutlook(inAreas, allAreas) {
  els.outlookNote.textContent = allAreas.length
    ? `${allAreas.length} disturbance(s) noted · ${inAreas.length} in your regions`
    : '';

  if (inAreas.length === 0) {
    els.outlook.replaceChildren(emptyCard('No disturbances being tracked in your regions right now.'));
    return;
  }

  const sorted = [...inAreas].sort((a, b) => formationRank(b) - formationRank(a));
  els.outlook.replaceChildren(...sorted.map(renderOutlookCard));
}

function renderOutlookCard(area) {
  const tone48 = formationTone(area.formationChance48h?.category);
  const tone7d = formationTone(area.formationChance7d?.category);

  const li = document.createElement('li');
  li.className = `card card--${tone7d}`;

  const head = document.createElement('div');
  head.className = 'card__head';

  const name = document.createElement('p');
  name.className = 'card__name';
  name.textContent = area.area;
  if (area.descriptor) {
    const sub = document.createElement('span');
    sub.className = 'card__subtle';
    sub.textContent = ` (${area.descriptor})`;
    name.append(sub);
  }
  head.append(name);
  li.append(head);

  const chips = document.createElement('div');
  chips.className = 'card__stats';
  if (area.formationChance48h) {
    chips.append(chipEl(`48h: ${area.formationChance48h.category} (${area.formationChance48h.percent})`, tone48));
  }
  if (area.formationChance7d) {
    chips.append(chipEl(`7d: ${area.formationChance7d.category} (${area.formationChance7d.percent})`, tone7d));
  }
  li.append(chips);

  if (area.text) {
    const body = document.createElement('p');
    body.className = 'card__body';
    body.textContent = area.text;
    li.append(body);
  }

  const foot = document.createElement('div');
  foot.className = 'card__foot card__foot--end';
  const links = document.createElement('span');
  links.className = 'card__links';
  links.append(linkEl('Full outlook', OUTLOOK_URL));
  foot.append(links);
  li.append(foot);

  return li;
}

/* -- shared card bits ------------------------------------------------------------ */

function emptyCard(text) {
  const li = document.createElement('li');
  li.className = 'card card--empty';
  const p = document.createElement('p');
  p.className = 'card__empty-text';
  p.textContent = text;
  li.append(p);
  return li;
}

function chipEl(text, tone) {
  const span = document.createElement('span');
  span.className = `badge badge--${tone}`;
  span.textContent = text;
  return span;
}

function linkEl(text, href) {
  const a = document.createElement('a');
  a.className = 'card__link';
  a.href = href;
  a.target = '_blank';
  a.rel = 'noopener';
  a.textContent = text;
  return a;
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
