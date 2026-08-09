/* ---------------------------------------------------------------------------
 * Pump — app
 *
 * Reads top to bottom:
 *   1. elements + state
 *   2. status
 *   3. render: verdict, rows, meta
 *   4. manual price entry
 *   5. load + refresh
 *   6. service worker
 *
 * All arithmetic lives in compare.js and all merging in store.js; this file
 * only turns the result into DOM. If you find yourself doing maths here, it
 * belongs in compare.js where the tests can reach it.
 * ------------------------------------------------------------------------- */

import { STATIONS, GRADE, THRESHOLD_PCT } from './stations.js';
import { evaluate, money, fmtPctNear, fmtCents, fmtAge } from './compare.js';
import { load, setOverride, clearOverride, clearAllOverrides, hasOverrides } from './store.js';

/* -- 1. elements + state -------------------------------------------------- */

const els = {
  status: document.getElementById('status'),
  verdict: document.getElementById('verdict'),
  verdictHeadline: document.getElementById('verdict-headline'),
  verdictDetail: document.getElementById('verdict-detail'),
  benchmarkNote: document.getElementById('benchmark-note'),
  stations: document.getElementById('stations'),
  updated: document.getElementById('updated'),
  refresh: document.getElementById('refresh'),
  dataError: document.getElementById('data-error'),
  clearAll: document.getElementById('clear-all')
};

// prices  — the merged map from store.load()
// editing — station id whose inline price input is open, or null
const state = { prices: {}, updated: null, error: null, editing: null };

/* -- 2. status ------------------------------------------------------------ */

function setStatus(kind, text) {
  els.status.className = `status status--${kind}`;
  els.status.textContent = text;
}

/* -- 3. render ------------------------------------------------------------ */

function render() {
  const result = evaluate(STATIONS, state.prices, THRESHOLD_PCT);

  renderVerdict(result);
  renderRows(result);
  renderMeta(result);
}

function renderVerdict({ verdict, benchmark, benchmarkStation }) {
  /* The verdict card is the only thing on screen with a colour that means
   * "act": green go to the loop, amber make the trip, grey we don't know. */
  const tone = {
    'preferred-wins': 'good',
    'preferred-ok': 'good',
    'costco-run': 'warn',
    'no-benchmark': 'unknown',
    'no-preferred': 'unknown'
  }[verdict.key] || 'unknown';

  els.verdict.className = `verdict verdict--${tone}`;
  els.verdictHeadline.textContent = verdict.headline;
  els.verdictDetail.textContent = verdict.detail || '';
  els.verdictDetail.classList.toggle('is-hidden', !verdict.detail);

  els.benchmarkNote.textContent = benchmark !== null && benchmarkStation
    ? `vs ${benchmarkStation.name} ${money(benchmark)}`
    : 'No benchmark price';
}

function renderRows(result) {
  els.stations.replaceChildren(...result.rows.map((row) => renderRow(row, result)));
}

function renderRow(row, result) {
  const { station } = row;

  const li = document.createElement('li');
  li.className = `station station--${row.tone}`;
  if (row.cheapest) li.classList.add('is-cheapest');

  /* -- left: who -- */
  const who = document.createElement('div');
  who.className = 'station__who';

  const name = document.createElement('a');
  name.className = 'station__name';
  name.href = station.url;
  name.target = '_blank';
  name.rel = 'noopener noreferrer';
  name.textContent = station.name;
  who.append(name);

  const tags = document.createElement('div');
  tags.className = 'station__tags';
  if (station.role === 'preferred') tags.append(tag('on the loop', 'pref'));
  if (station.role === 'benchmark') tags.append(tag('benchmark', 'bench'));
  if (row.cheapest) tags.append(tag('cheapest', 'cheap'));
  if (row.manual) tags.append(tag('typed', 'manual'));
  if (row.status === 'stale') tags.append(tag('stale', 'stale'));
  if (tags.children.length) who.append(tags);

  const where = document.createElement('p');
  where.className = 'station__where';
  where.textContent = station.where;
  who.append(where);

  /* -- right: what it costs -- */
  const what = document.createElement('div');
  what.className = 'station__what';

  const price = document.createElement('p');
  price.className = 'station__price';
  price.textContent = money(row.price);
  what.append(price);

  const delta = document.createElement('p');
  delta.className = 'station__delta';
  if (station.role === 'benchmark') {
    delta.textContent = 'the yardstick';
  } else if (row.pct === null) {
    delta.textContent = row.price === null ? 'no price' : 'nothing to compare';
  } else {
    delta.textContent = `${fmtPctNear(row.pct, result.threshold)} · ${fmtCents(row.cents)}`;
  }
  what.append(delta);

  li.append(who, what);

  /* -- under: age, note, and the edit affordance -- */
  const foot = document.createElement('div');
  foot.className = 'station__foot';

  const age = document.createElement('span');
  age.className = 'station__age';
  age.textContent = row.price === null ? '' : fmtAge(row.observed);
  foot.append(age);

  const actions = document.createElement('span');
  actions.className = 'station__actions';

  const edit = document.createElement('button');
  edit.type = 'button';
  edit.className = 'btn btn--tiny';
  edit.textContent = row.price === null ? 'Add price' : 'Edit';
  edit.addEventListener('click', () => {
    state.editing = state.editing === station.id ? null : station.id;
    render();
  });
  actions.append(edit);

  if (row.manual) {
    const reset = document.createElement('button');
    reset.type = 'button';
    reset.className = 'btn btn--tiny';
    reset.textContent = 'Use fetched';
    reset.addEventListener('click', () => {
      clearOverride(station.id);
      state.editing = null;
      refresh();
    });
    actions.append(reset);
  }

  foot.append(actions);
  li.append(foot);

  /* A note is either a fetch failure or an explanation of why there is no
   * number. Both are worth reading, so neither is hidden. */
  if (row.note && !row.manual) {
    const note = document.createElement('p');
    note.className = 'station__note';
    note.textContent = row.note;
    li.append(note);
  }

  if (state.editing === station.id) li.append(renderEditor(row));

  return li;
}

function tag(text, kind) {
  const el = document.createElement('span');
  el.className = `tag tag--${kind}`;
  el.textContent = text;
  return el;
}

/* -- 4. manual price entry ------------------------------------------------ */

/* The app has to be useful before the fetcher is trustworthy, and 7-Eleven
 * publishes nothing at all, so typing a price in has to be a first-class
 * path rather than a debug affordance. */
function renderEditor(row) {
  const form = document.createElement('form');
  form.className = 'editor';

  const input = document.createElement('input');
  input.className = 'editor__input';
  input.type = 'number';
  /* decimal keypad on iOS, and a tenth-of-a-cent step because that is how
   * pump prices are actually written. */
  input.inputMode = 'decimal';
  input.step = '0.001';
  input.min = '0';
  input.placeholder = '3.499';
  input.setAttribute('aria-label', `Price at ${row.station.name}`);
  if (row.price !== null) input.value = row.price.toFixed(3);

  const save = document.createElement('button');
  save.type = 'submit';
  save.className = 'btn btn--small';
  save.textContent = 'Save';

  const cancel = document.createElement('button');
  cancel.type = 'button';
  cancel.className = 'btn btn--tiny';
  cancel.textContent = 'Cancel';
  cancel.addEventListener('click', () => { state.editing = null; render(); });

  const error = document.createElement('p');
  error.className = 'editor__error is-hidden';

  form.addEventListener('submit', (event) => {
    event.preventDefault();
    const value = parseFloat(input.value);

    /* Reject the fat-finger cases loudly rather than storing them: a price
     * that is not a plausible per-gallon number is a typo, not a bargain. */
    if (!Number.isFinite(value) || value <= 0) {
      return fail('Enter a price like 3.499');
    }
    if (value > 12) {
      return fail('That looks like a total, not a price per gallon');
    }
    if (!setOverride(row.station.id, Math.round(value * 1000) / 1000)) {
      return fail('Could not save — storage is unavailable in this browser');
    }

    state.editing = null;
    refresh();

    function fail(message) {
      error.textContent = message;
      error.classList.remove('is-hidden');
      input.focus();
    }
  });

  form.append(input, save, cancel, error);

  /* Focus after the row is in the document, so iOS actually opens the keypad. */
  requestAnimationFrame(() => { input.focus(); input.select(); });

  return form;
}

/* -- 5. load + refresh ---------------------------------------------------- */

function renderMeta({ updated }) {
  /* Prefer the newest observation over the file's own `updated` stamp: a
   * typed price is newer than the last workflow run and should say so. */
  const stamp = updated || state.updated;
  els.updated.textContent = stamp ? `Prices ${fmtAge(stamp)} · ${GRADE.toLowerCase()}` : 'No prices yet';

  els.dataError.textContent = state.error ? `Could not load prices.json — ${state.error}` : '';
  els.dataError.classList.toggle('is-hidden', !state.error);

  els.clearAll.classList.toggle('is-hidden', !hasOverrides());
}

async function refresh() {
  setStatus('loading', 'loading');
  const result = await load();

  state.prices = result.prices;
  state.updated = result.updated;
  state.error = result.error;

  render();

  const known = Object.values(state.prices).filter((e) => typeof e.price === 'number').length;
  if (state.error && known === 0) setStatus('error', 'offline');
  else if (state.error) setStatus('warn', 'partial');
  else setStatus('ok', 'ready');
}

els.refresh.addEventListener('click', refresh);
els.clearAll.addEventListener('click', () => {
  clearAllOverrides();
  state.editing = null;
  refresh();
});

/* Coming back to a home-screen app after a day should not show yesterday's
 * numbers just because the tab was never closed. */
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'visible') refresh();
});

refresh();

/* -- 6. service worker ---------------------------------------------------- */

if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('./sw.js').catch(() => {
      /* No offline shell; the app still works online. Not worth a message. */
    });
  });
}
