/* ---------------------------------------------------------------------------
 * Landing page — the highlight from each app, bubbled up
 *
 * Reads top to bottom:
 *   1. helpers
 *   2. Cone   — count + colour, from the two committed data files
 *   3. Pump   — cheapest price + where, and the go / no-go verdict
 *   4. Slate  — the followed team's logo and the next kick / puck drop
 *   5. Signal — a station dropdown and a play button; the card is the player
 *
 * Nothing here is new logic. Every number, tone and label comes from the same
 * modules the apps themselves import, so a card can't disagree with the app
 * it opens. Cone and Pump read the JSON the workflows commit (the "pipeline"
 * output — there is nothing to rebuild, the page just reads the file); Slate
 * calls ESPN directly, exactly as the app does, because ESPN sends CORS
 * headers; Signal plays through its own <audio> element on this page.
 *
 * Each card loads independently: a dead ESPN never blanks the storm count.
 * ------------------------------------------------------------------------- */

import { classificationInfo, formationTone } from './hurricane-tracker/js/filter.js';
import { fmtAge as coneAge, localizeGulf } from './hurricane-tracker/js/format.js';

import { STATIONS as PUMP_STATIONS, THRESHOLD_PCT } from './gas-prices/js/stations.js';
import { evaluate, money, fmtCentsAbs, fmtAge as pumpAge } from './gas-prices/js/compare.js';
import { readOverrides, mergePrices } from './gas-prices/js/store.js';

import { TEAMS, HORIZON_DAYS } from './sports-schedule/js/teams.js';
import { fetchAll } from './sports-schedule/js/espn.js';
import { readCache, writeCache } from './sports-schedule/js/store.js';
import { bucket, formatTime, dayLabel, statusLine, scoreLine, fmtAge as slateAge } from './sports-schedule/js/schedule.js';

/* -- 1. helpers ----------------------------------------------------------- */

const el = (id) => document.getElementById(id);

/* Cache-bust every data read. The apps' service workers don't control this
 * page, but GitHub Pages' CDN is still in front of it, and a phone that has
 * kept this tab open all week should not see Tuesday's numbers. */
async function loadJson(path) {
  const res = await fetch(`${path}?t=${Date.now()}`, { cache: 'no-store' });
  if (!res.ok) throw new Error(`${path}: HTTP ${res.status}`);
  return res.json();
}

function setTone(card, tone) {
  card.dataset.tone = tone || 'none';
}

function plural(n, word) {
  return `${n} ${word}${n === 1 ? '' : 's'}`;
}

function capitalize(s) {
  return s ? s[0].toUpperCase() + s.slice(1) : '';
}

/* -- 2. Cone -------------------------------------------------------------- */

/* high(3) > medium(2) > low(1) > none(0): the same ladder the app's banner
 * uses to decide what the worst thing in the region is. */
function formationRank(area) {
  const rank = { high: 3, medium: 2, low: 1 };
  return Math.max(
    rank[area.formationChance48h?.category] || 0,
    rank[area.formationChance7d?.category] || 0
  );
}

async function renderCone() {
  const card = el('cone');
  const settle = (p) => p.then((data) => ({ data }), (error) => ({ error }));
  const [storms, outlook] = await Promise.all([
    settle(loadJson('./hurricane-tracker/data/current-storms.json')),
    settle(loadJson('./hurricane-tracker/data/outlook-atlantic.json'))
  ]);

  if (storms.error && outlook.error) {
    el('cone-head').textContent = 'Could not load storm data';
    el('cone-sub').textContent = storms.error.message;
    return;
  }

  const inStorms = ((storms.data && storms.data.storms) || [])
    .filter((s) => s.inRegion)
    .sort((a, b) => classificationInfo(b.classification).rank - classificationInfo(a.classification).rank);
  const inAreas = ((outlook.data && outlook.data.areas) || [])
    .filter((a) => a.inRegion)
    .sort((a, b) => formationRank(b) - formationRank(a));

  /* The count is everything in the region: named systems plus outlook areas.
   * The headline is the single worst one, since that is what to worry about. */
  let tone;
  let headline;
  if (inStorms.length) {
    const worst = inStorms[0];
    const info = classificationInfo(worst.classification);
    tone = info.tone;
    headline = `${info.label} ${worst.name}`;
  } else if (inAreas.length) {
    const worst = inAreas[0];
    const chance = worst.formationChance7d || worst.formationChance48h;
    tone = formationTone(chance && chance.category);
    headline = chance
      ? `${capitalize(chance.category)} chance · ${localizeGulf(worst.area)}`
      : localizeGulf(worst.area);
  } else {
    tone = 'good';
    headline = 'All quiet';
  }

  el('cone-count').textContent = String(inStorms.length + inAreas.length);
  el('cone-head').textContent = headline;
  el('cone-sub').textContent = `${plural(inStorms.length, 'storm')}, ${plural(inAreas.length, 'outlook area')} in your regions`;

  const stamps = [storms.data && storms.data.updated, outlook.data && outlook.data.updated].filter(Boolean);
  const newest = stamps.length ? stamps.sort().at(-1) : null;
  const failed = storms.error || outlook.error ? ' · one source failed to load' : '';
  el('cone-meta').textContent = `Updated ${coneAge(newest)}${failed}`;

  setTone(card, tone === 'muted' ? 'none' : tone);
}

/* -- 3. Pump -------------------------------------------------------------- */

async function renderPump() {
  const card = el('pump');
  let published;
  try {
    published = await loadJson('./gas-prices/data/prices.json');
  } catch (error) {
    el('pump-head').textContent = 'Could not load prices';
    el('pump-sub').textContent = error.message;
    return;
  }

  /* Same merge as the app, typed-in prices included: localStorage is
   * per-origin, and this page shares the origin with the app. */
  const prices = mergePrices(published, readOverrides());
  const result = evaluate(PUMP_STATIONS, prices, THRESHOLD_PCT);
  const best = result.rows.find((r) => r.cheapest) || null;
  const pref = result.rows.find((r) => r.station.role === 'preferred') || null;

  /* Big number and headline: the best price and where it is. The verdict —
   * the app's own go / no-go line — sits under it and colours the card. */
  el('pump-price').textContent = best ? money(best.price) : '—';
  el('pump-head').textContent = best ? `${best.station.icon} ${best.station.name}` : 'No prices';
  el('pump-sub').textContent = result.verdict.headline;

  const bits = [];
  if (pref && pref.price !== null && !pref.cheapest) {
    bits.push(`${pref.station.name} ${money(pref.price)}${pref.cents !== null ? ` · ${fmtCentsAbs(pref.cents)} over` : ''}`);
  }
  bits.push(`Prices ${pumpAge(result.updated || published.updated)}`);
  el('pump-meta').textContent = bits.join(' · ');

  setTone(card, {
    'preferred-wins': 'good',
    'preferred-ok': 'good',
    'costco-run': 'warn'
  }[result.verdict.key] || 'none');
}

/* -- 4. Slate ------------------------------------------------------------- */

const TZ = Intl.DateTimeFormat().resolvedOptions().timeZone;

/* The one game worth a card. In order: a game in progress, a game still to
 * come today, the first game in the next 7 days, today's final if that's all
 * there was, and lastly the first game beyond the horizon so an empty week
 * still says when the wait ends. */
function pickGame(games, now) {
  const { todayKey, today, upcoming, next } = bucket(games, now, { timeZone: TZ, days: HORIZON_DAYS });

  const live = today.find((g) => g.state === 'in');
  if (live) return { game: live, key: todayKey, todayKey };

  const pending = today.find((g) => g.state !== 'post');
  if (pending) return { game: pending, key: todayKey, todayKey };

  for (const day of upcoming) {
    if (day.games.length) return { game: day.games[0], key: day.key, todayKey };
  }
  if (today.length) return { game: today[today.length - 1], key: todayKey, todayKey };
  if (next) return { game: next.game, key: next.key, todayKey };
  return null;
}

function renderSlateGame(games, fetchedAt, fromCache) {
  const card = el('slate');
  const crest = el('slate-crest');
  const img = crest.querySelector('img');
  const pick = pickGame(games, new Date());

  if (!pick) {
    el('slate-head').textContent = 'Nothing scheduled';
    el('slate-sub').textContent = 'No games on the books for any team';
    crest.classList.add('crest--text');
    crest.replaceChildren(img, '—');
    return;
  }

  const { game, key, todayKey } = pick;
  const team = TEAMS.find((t) => t.id === game.teamId) || { label: game.team.name };

  /* The followed team's own mark, on the light chip the app uses. */
  crest.classList.toggle('crest--text', !game.team.logo);
  crest.replaceChildren(img);
  if (game.team.logo) {
    img.src = game.team.logo;
    img.onerror = () => {
      crest.classList.add('crest--text');
      crest.append(game.team.abbr || '?');
    };
  } else {
    crest.append(game.team.abbr || '?');
  }

  const sep = game.neutral || game.home ? 'vs' : '@';
  const rank = game.opponent.rank ? `#${game.opponent.rank} ` : '';
  el('slate-head').textContent = `${team.label} ${sep} ${rank}${game.opponent.name}`;

  const status = statusLine(game, TZ);
  const score = scoreLine(game);
  let when;
  if (game.state === 'in') {
    when = `LIVE ${score ? score.text + ' · ' : ''}${status.text}`;
  } else if (game.state === 'post') {
    when = `Final${score ? ` · ${score.result} ${score.text}` : ''}`;
  } else {
    when = `${dayLabel(key, todayKey)} · ${formatTime(game.start, TZ, game.timeValid)}`;
  }
  const tv = game.broadcasts.find((b) => b.kind !== 'radio');
  el('slate-sub').textContent = tv ? `${when} · ${tv.name}` : when;
  el('slate-sub').classList.toggle('live-text', game.state === 'in');

  card.classList.toggle('is-live', game.state === 'in');
  card.style.borderColor = game.state === 'in' ? '' : game.accent;
  el('slate-meta').textContent = `${game.league} · updated ${slateAge(fetchedAt)}${fromCache ? ' (cached)' : ''}`;
}

async function renderSlate() {
  /* Paint the app's own cache first — same origin, same key — so the card is
   * never blank while nine ESPN requests are in flight. */
  const cached = readCache();
  if (cached) renderSlateGame(cached.games, cached.fetchedAt, true);

  let result;
  try {
    result = await fetchAll(TEAMS);
  } catch (error) {
    result = { games: [], failures: TEAMS.map((team) => ({ team, error })) };
  }

  if (result.failures.length === TEAMS.length) {
    if (!cached) {
      el('slate-head').textContent = 'Could not reach ESPN';
      el('slate-sub').textContent = 'Nothing cached yet';
    } else {
      el('slate-meta').textContent += ' · ESPN unreachable';
    }
    return;
  }

  const fetchedAt = new Date().toISOString();
  writeCache(result.games, fetchedAt);
  renderSlateGame(result.games, fetchedAt, false);
  if (result.failures.length) {
    el('slate-meta').textContent += ` · ${result.failures.map((f) => f.team.label).join(', ')} failed`;
  }
}

/* -- 5. Signal ------------------------------------------------------------ */
/* A cut-down copy of the app's player: one <audio>, swap .src per station,
 * one retry with a fresh URL on error, MediaSession for the lock screen.
 * `STATIONS` is the global that signal-radio/js/adapters.js (a classic
 * script, loaded before this module) defines, so the station list and the
 * stream URLs are the app's own. Playback stops if you navigate away — this
 * is a page, not a single-page app — which is the one real difference. */

const RADIO_STATIONS = typeof STATIONS !== 'undefined' ? STATIONS : [];
const LAST_STATION_KEY = 'landing.signal.station';

const audio = el('signal-audio');
const radioEls = {
  card: el('signal'),
  status: el('signal-status'),
  select: el('signal-station'),
  play: el('signal-play'),
  iconPlay: el('signal-icon-play'),
  iconPause: el('signal-icon-pause'),
  sub: el('signal-sub')
};

const radio = { status: 'idle', loadId: 0, attemptId: 0, retried: false };

function radioStation() {
  return RADIO_STATIONS[radioEls.select.selectedIndex] || null;
}

function radioSetStatus(next) {
  radio.status = next;
  radioEls.status.textContent = next;
  radioEls.status.className = `pill pill--${next}`;

  const playing = next === 'loading' || next === 'live';
  radioEls.iconPlay.classList.toggle('is-hidden', playing);
  radioEls.iconPause.classList.toggle('is-hidden', !playing);
  radioEls.play.setAttribute('aria-label', playing ? 'Pause' : 'Play');

  setTone(radioEls.card, { live: 'good', loading: 'warn', error: 'bad' }[next] || 'none');

  if ('mediaSession' in navigator) {
    navigator.mediaSession.playbackState =
      next === 'live' ? 'playing' : next === 'paused' ? 'paused' : 'none';
  }
}

function radioStart() {
  const attemptId = ++radio.attemptId;
  const playing = audio.play();
  if (!playing || !playing.catch) return;
  playing.catch((err) => {
    if (attemptId !== radio.attemptId) return;
    if (err && err.name === 'AbortError') return;
    if (radio.status !== 'error') radioSetStatus('paused');
  });
}

async function radioLoad(station, { retry = false } = {}) {
  const loadId = retry ? radio.loadId : ++radio.loadId;
  if (!retry) radio.retried = false;
  radioSetStatus('loading');

  let url;
  try {
    url = await station.getStreamUrl();
  } catch (err) {
    if (loadId === radio.loadId) radioSetStatus('error');
    return;
  }
  if (loadId !== radio.loadId) return;
  if (!url) { radioSetStatus('error'); return; }

  audio.src = url;
  audio.load();
  radioStart();
}

function radioPlay() {
  const station = radioStation();
  if (!station) return;
  if (!audio.src || radio.status === 'error') {
    radioLoad(station);
    return;
  }
  radioSetStatus('loading');
  radioStart();
}

function radioPause() {
  if (audio.src) audio.pause();
}

function radioToggle() {
  if (radio.status === 'live' || radio.status === 'loading') radioPause();
  else radioPlay();
}

function radioSelect(index, { play = false } = {}) {
  const station = RADIO_STATIONS[index];
  if (!station) return;
  radioEls.select.selectedIndex = index;
  radioEls.sub.textContent = station.sub;
  try { localStorage.setItem(LAST_STATION_KEY, station.id); } catch (err) { /* private mode */ }
  radioMediaSession(station);
  if (play) radioLoad(station);
}

function radioStep(delta) {
  const n = RADIO_STATIONS.length;
  if (!n) return;
  const next = (radioEls.select.selectedIndex + delta + n) % n;
  radioSelect(next, { play: true });
}

function radioMediaSession(station) {
  if (!('mediaSession' in navigator)) return;
  navigator.mediaSession.metadata = new MediaMetadata({
    title: station.name,
    artist: station.sub,
    album: 'Signal',
    artwork: [
      { src: './signal-radio/icons/icon-192.png', sizes: '192x192', type: 'image/png' },
      { src: './signal-radio/icons/icon-512.png', sizes: '512x512', type: 'image/png' }
    ]
  });
}

function setupSignal() {
  if (!RADIO_STATIONS.length) {
    radioEls.sub.textContent = 'No stations found';
    radioEls.play.disabled = true;
    return;
  }

  radioEls.select.replaceChildren(...RADIO_STATIONS.map((station) => {
    const option = document.createElement('option');
    option.value = station.id;
    option.textContent = station.name;
    return option;
  }));

  let last = null;
  try { last = localStorage.getItem(LAST_STATION_KEY); } catch (err) { /* private mode */ }
  const start = Math.max(0, RADIO_STATIONS.findIndex((s) => s.id === last));
  radioSelect(start);

  /* Changing station while something is playing switches straight over, as
   * tapping a card in the app does; otherwise it just arms the play button. */
  radioEls.select.addEventListener('change', () => {
    const playing = radio.status === 'live' || radio.status === 'loading';
    radioSelect(radioEls.select.selectedIndex, { play: playing });
  });
  radioEls.play.addEventListener('click', radioToggle);

  audio.addEventListener('playing', () => radioSetStatus('live'));
  audio.addEventListener('waiting', () => { if (radio.status === 'live') radioSetStatus('loading'); });
  audio.addEventListener('pause', () => {
    /* load() resets the element and can fire a spurious 'pause'. */
    if (audio.readyState === 0) return;
    if (radio.status !== 'error') radioSetStatus('paused');
  });
  audio.addEventListener('error', () => {
    const station = radioStation();
    if (!station || radio.retried) { radioSetStatus('error'); return; }
    radio.retried = true;
    radioLoad(station, { retry: true });
  });

  if ('mediaSession' in navigator) {
    navigator.mediaSession.setActionHandler('play', radioPlay);
    navigator.mediaSession.setActionHandler('pause', radioPause);
    navigator.mediaSession.setActionHandler('previoustrack', () => radioStep(-1));
    navigator.mediaSession.setActionHandler('nexttrack', () => radioStep(1));
  }
}

/* -- go ------------------------------------------------------------------- */

setupSignal();
renderCone();
renderPump();
renderSlate();

/* Coming back to the page after a day should not show yesterday's numbers
 * just because the tab was never closed. Signal is left alone: a refresh
 * must never interrupt what's playing. */
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState !== 'visible') return;
  renderCone();
  renderPump();
  renderSlate();
});
