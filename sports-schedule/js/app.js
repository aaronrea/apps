/* ---------------------------------------------------------------------------
 * Slate — app
 *
 * Reads top to bottom:
 *   1. elements + state
 *   2. status
 *   3. render: today, the week, meta
 *   4. one game card
 *   5. load + refresh
 *   6. service worker
 *
 * No dates are computed here and no ESPN shapes are understood here. Bucketing
 * and formatting live in schedule.js where the tests can reach them, and the
 * payload is turned into plain game objects in espn.js. This file turns those
 * objects into DOM and nothing else.
 * ------------------------------------------------------------------------- */

import { TEAMS, HORIZON_DAYS } from './teams.js';
import { fetchAll } from './espn.js';
import { readCache, writeCache } from './store.js';
import {
  bucket, dayLabel, formatDay, formatTime, zoneLabel, statusLine, scoreLine, fmtAge
} from './schedule.js';

/* -- 1. elements + state --------------------------------------------------- */

const els = {
  status: document.getElementById('status'),
  todayDate: document.getElementById('today-date'),
  today: document.getElementById('today'),
  horizon: document.getElementById('horizon-label'),
  zoneNote: document.getElementById('zone-note'),
  upcoming: document.getElementById('upcoming'),
  updated: document.getElementById('updated'),
  refresh: document.getElementById('refresh'),
  error: document.getElementById('data-error')
};

const state = {
  games: [],
  fetchedAt: null,
  /* Which teams could not be reached on the last attempt. */
  failures: [],
  loading: false
};

/* The viewer's zone, resolved once. Everything is rendered in it, and it is
 * printed on screen so a time is never ambiguous. */
const TZ = Intl.DateTimeFormat().resolvedOptions().timeZone;

/* Fresh enough that a live score is worth re-reading, rare enough that a quiet
 * Tuesday does not hammer ESPN from a phone in someone's pocket. */
const IDLE_MS = 10 * 60 * 1000;
const LIVE_MS = 60 * 1000;

let timer = null;

/* -- 2. status ------------------------------------------------------------- */

function setStatus(kind, text) {
  els.status.className = `status status--${kind}`;
  els.status.textContent = text;
}

/* -- 3. render ------------------------------------------------------------- */

function render() {
  const now = new Date();
  const view = bucket(state.games, now, { timeZone: TZ, days: HORIZON_DAYS });

  els.todayDate.textContent = formatDay(view.todayKey);
  els.horizon.textContent = `Next ${HORIZON_DAYS} days`;
  els.zoneNote.textContent = `Times in ${zoneLabel(now, TZ)}`;

  renderToday(view);
  renderUpcoming(view);
  renderMeta(now);
}

function renderToday(view) {
  if (!view.today.length) {
    els.today.replaceChildren(emptyRow('Nothing today.'));
    return;
  }
  els.today.replaceChildren(...view.today.map(gameCard));
}

function renderUpcoming(view) {
  const days = view.upcoming.filter((day) => day.games.length);

  if (!days.length) {
    /* An empty week is the normal state for most of the summer, so it gets a
     * real answer — when the wait ends — rather than a shrug. */
    const message = view.next
      ? `Nothing in the next ${HORIZON_DAYS} days. Next up ${formatDay(view.next.key)}.`
      : `Nothing scheduled in the next ${HORIZON_DAYS} days.`;

    const wrap = document.createElement('div');
    wrap.append(emptyRow(message));
    if (view.next) wrap.append(gameCard(view.next.game));
    els.upcoming.replaceChildren(wrap);
    return;
  }

  els.upcoming.replaceChildren(...days.map((day) => {
    const section = document.createElement('section');
    section.className = 'day';

    const heading = document.createElement('h3');
    heading.className = 'day__label';
    heading.textContent = dayLabel(day.key, view.todayKey);
    section.append(heading);

    const list = document.createElement('ul');
    list.className = 'games';
    list.append(...day.games.map(gameCard));
    section.append(list);

    return section;
  }));
}

function emptyRow(text) {
  const li = document.createElement('li');
  li.className = 'empty';
  li.textContent = text;
  return li;
}

function renderMeta(now) {
  els.updated.textContent = state.fetchedAt
    ? `Updated ${fmtAge(state.fetchedAt, now)}`
    : 'Not loaded yet';

  /* Name the teams that failed. "Something went wrong" is not actionable;
   * "couldn't reach NHL" tells you which section to distrust. */
  const names = state.failures.map((f) => f.team.league).join(', ');
  els.error.textContent = names ? `Couldn't reach ESPN for ${names}. Showing what loaded.` : '';
  els.error.classList.toggle('is-hidden', !names);
}

/* -- 4. one game card ------------------------------------------------------ */

function gameCard(game) {
  const li = document.createElement('li');
  li.className = 'game';
  if (game.state === 'in') li.classList.add('is-live');
  /* The card's edge is the team's colour — the fastest way to tell three
   * leagues apart in a stacked list without reading a word. */
  li.style.setProperty('--accent', game.accent);

  const main = document.createElement('div');
  main.className = 'game__main';
  main.append(matchup(game), when(game));
  li.append(main);

  const foot = details(game);
  if (foot) li.append(foot);

  return li;
}

function matchup(game) {
  const wrap = document.createElement('div');
  wrap.className = 'matchup';

  wrap.append(crest(game.team), crest(game.opponent));

  const text = document.createElement('div');
  text.className = 'matchup__text';

  const line = document.createElement('p');
  line.className = 'matchup__line';
  /* The spaces around the separator are real text nodes, not CSS margins.
   * Without them the browser sees "BuccaneersvsSeahawks" as one unbreakable
   * word — it overflows the card instead of wrapping, and a screen reader
   * reads it as a single token. */
  line.append(
    teamName(game.team),
    ' ',
    /* "vs" or "@" is the only place home and away is stated, so it carries
     * real weight rather than being punctuation. */
    separator(game),
    ' ',
    teamName(game.opponent)
  );
  text.append(line);

  const sub = document.createElement('p');
  sub.className = 'matchup__sub';
  sub.append(tag(game.league, 'league'));
  if (game.note) sub.append(document.createTextNode(` ${game.note}`));
  text.append(sub);

  wrap.append(text);
  return wrap;
}

function teamName(side) {
  const span = document.createElement('span');
  span.className = 'matchup__team';
  if (side.rank) {
    const rank = document.createElement('span');
    rank.className = 'matchup__rank';
    rank.textContent = `#${side.rank}`;
    span.append(rank, ' ');
  }
  span.append(side.name);
  return span;
}

function separator(game) {
  const span = document.createElement('span');
  span.className = 'matchup__sep';
  span.textContent = game.neutral ? 'vs' : game.home ? 'vs' : '@';
  return span;
}

/* Full-colour marks on a light chip. ESPN's alternative is a white silhouette
 * that would sit on the dark card unaided, but a monochrome Lightning bolt and
 * a monochrome Aggie block are much harder to tell apart in a hurry. */
function crest(side) {
  const chip = document.createElement('span');
  chip.className = 'crest';

  if (!side.logo) {
    chip.classList.add('crest--text');
    chip.textContent = side.abbr || '?';
    return chip;
  }

  const img = document.createElement('img');
  img.src = side.logo;
  img.alt = '';
  img.loading = 'lazy';
  img.decoding = 'async';
  /* A missing mark falls back to the abbreviation rather than a broken image
   * icon — new and lower-division opponents do turn up without one. */
  img.addEventListener('error', () => {
    chip.classList.add('crest--text');
    chip.textContent = side.abbr || '?';
  }, { once: true });

  chip.append(img);
  return chip;
}

function when(game) {
  const wrap = document.createElement('div');
  wrap.className = 'game__when';

  const status = statusLine(game, TZ);
  const score = scoreLine(game);

  const lead = document.createElement('p');
  lead.className = 'game__lead';

  if (score) {
    if (score.result) {
      const result = document.createElement('span');
      result.className = `result result--${score.result.toLowerCase()}`;
      result.textContent = score.result;
      lead.append(result, ' ');
    }
    lead.append(score.text);
  } else {
    lead.textContent = status.text;
  }
  wrap.append(lead);

  /* With a score on the top line, the status moves under it; without one the
   * top line already is the status and repeating it would be noise. */
  if (score) {
    const sub = document.createElement('p');
    sub.className = `game__status game__status--${status.tone}`;
    sub.textContent = status.text;
    wrap.append(sub);
  } else if (status.tone === 'live') {
    lead.classList.add('is-live-text');
  }

  return wrap;
}

function details(game) {
  const bits = [];

  if (game.venue && game.venue.name) {
    bits.push(game.neutral ? `${game.venue.name} (neutral)` : game.venue.name);
  }

  const foot = document.createElement('div');
  foot.className = 'game__foot';

  if (bits.length) {
    const where = document.createElement('span');
    where.className = 'game__where';
    where.textContent = bits.join(' · ');
    foot.append(where);
  }

  if (game.broadcasts.length) {
    const channels = document.createElement('span');
    channels.className = 'game__channels';
    for (const b of game.broadcasts) {
      /* Home-market entries are the regional feed; saying so is the honest
       * version of listing a channel that may be dark where you are. */
      const label = b.market === 'Home' || b.market === 'Away' ? `${b.name} (regional)` : b.name;
      channels.append(tag(label, b.kind));
    }
    foot.append(channels);
  }

  if (game.link) {
    const link = document.createElement('a');
    link.className = 'game__link';
    link.href = game.link;
    link.target = '_blank';
    link.rel = 'noopener noreferrer';
    /* Not "ESPN" — a card can already carry a channel tag reading ESPN, and
     * two different things with the same name on one row is a puzzle. */
    link.textContent = 'Details';
    foot.append(link);
  }

  return foot.childElementCount ? foot : null;
}

function tag(text, kind) {
  const el = document.createElement('span');
  el.className = `tag tag--${kind}`;
  el.textContent = text;
  return el;
}

/* -- 5. load + refresh ----------------------------------------------------- */

/* The cache paints first so the app is never blank, then the network
 * overwrites it. On a home-screen launch that is the difference between a
 * schedule and a spinner. */
function paintFromCache() {
  const cached = readCache();
  if (!cached) return false;

  state.games = cached.games;
  state.fetchedAt = cached.fetchedAt;
  render();
  return true;
}

async function refresh() {
  if (state.loading) return;
  state.loading = true;
  setStatus('loading', 'loading');

  try {
    const { games, failures } = await fetchAll(TEAMS);
    state.failures = failures;

    /* Everything failing means no signal, or ESPN is down, or the API moved.
     * Whichever it is, the cache is better than an empty screen. */
    if (failures.length === TEAMS.length) {
      setStatus('error', state.games.length ? 'offline' : 'no data');
    } else {
      state.games = games;
      state.fetchedAt = new Date().toISOString();
      writeCache(games, state.fetchedAt);
      setStatus(failures.length ? 'warn' : 'ok', failures.length ? 'partial' : 'ready');
    }
  } catch (error) {
    /* fetchAll isolates per team, so reaching here means something structural. */
    state.failures = TEAMS.map((team) => ({ team, error }));
    setStatus('error', 'error');
  } finally {
    state.loading = false;
    render();
    queueNext();
  }
}

/* Poll hard only while something is actually being played. */
function queueNext() {
  clearTimeout(timer);
  const live = state.games.some((g) => g.state === 'in');
  timer = setTimeout(refresh, live ? LIVE_MS : IDLE_MS);
}

els.refresh.addEventListener('click', refresh);

/* Coming back to a home-screen app tomorrow should not show yesterday's
 * "Today". Re-render immediately for the date, then re-fetch for the scores. */
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState !== 'visible') return;
  render();
  refresh();
});

paintFromCache();
refresh();

/* -- 6. service worker ----------------------------------------------------- */

if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('./sw.js').catch(() => {
      /* No offline shell; the app still works online. Not worth a message. */
    });
  });
}
