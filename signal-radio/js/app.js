/* ---------------------------------------------------------------------------
 * Signal — app
 *
 * Reads top to bottom:
 *   1. elements + state
 *   2. event log
 *   3. status
 *   4. rendering
 *   5. the single <audio> element: load / play / pause / retry
 *   6. station selection (prev / next)
 *   7. MediaSession (lock screen)
 *   8. UI wiring
 *   9. service worker
 * ------------------------------------------------------------------------- */

/* -- 1. elements + state -------------------------------------------------- */

const audio = document.getElementById('audio');

const els = {
  status: document.getElementById('status'),
  nowName: document.getElementById('now-name'),
  nowSub: document.getElementById('now-sub'),
  playpause: document.getElementById('playpause'),
  iconPlay: document.getElementById('icon-play'),
  iconPause: document.getElementById('icon-pause'),
  prev: document.getElementById('prev'),
  next: document.getElementById('next'),
  stations: document.getElementById('stations'),
  log: document.getElementById('log'),
  logClear: document.getElementById('log-clear')
};

// index      — which station is selected (-1 = none yet)
// status     — idle | loading | live | paused | error
// loadId     — bumped on every load so a slow getStreamUrl() from an
//              abandoned station can't clobber the current one
// attemptId  — bumped on every play() so a late rejection from a superseded
//              attempt can't clobber the current status
// retried    — true once we've already retried the current load after an error
const state = {
  index: -1,
  status: 'idle',
  loadId: 0,
  attemptId: 0,
  retried: false
};

const MAX_LOG_LINES = 100;

function currentStation() {
  return state.index >= 0 ? STATIONS[state.index] : null;
}

/* -- 2. event log --------------------------------------------------------- */

function log(message) {
  const time = new Date().toLocaleTimeString([], { hour12: false });

  const li = document.createElement('li');
  li.className = 'log__line';
  li.innerHTML = '<span class="log__time"></span><span class="log__msg"></span>';
  li.firstChild.textContent = time;
  li.lastChild.textContent = message;

  els.log.appendChild(li);
  while (els.log.children.length > MAX_LOG_LINES) {
    els.log.removeChild(els.log.firstChild);
  }
  els.log.scrollTop = els.log.scrollHeight;

  console.log('[signal]', time, message);
}

/* -- 3. status ------------------------------------------------------------ */

function setStatus(next) {
  if (state.status === next) return;
  state.status = next;
  els.status.textContent = next;
  els.status.className = 'status status--' + next;
  log('status → ' + next);

  // Keeps the lock screen showing the right play/pause button.
  if ('mediaSession' in navigator) {
    navigator.mediaSession.playbackState =
      next === 'live' ? 'playing' : next === 'paused' ? 'paused' : 'none';
  }

  render();
}

/* -- 4. rendering --------------------------------------------------------- */

function renderStations() {
  els.stations.innerHTML = '';

  STATIONS.forEach((station, i) => {
    const li = document.createElement('li');

    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'card' + (i === state.index ? ' card--active' : '');
    button.setAttribute('aria-pressed', String(i === state.index));
    button.addEventListener('click', () => selectStation(i));

    const text = document.createElement('span');
    text.className = 'card__text';

    const name = document.createElement('span');
    name.className = 'card__name';
    name.textContent = station.name;

    const sub = document.createElement('span');
    sub.className = 'card__sub';
    sub.textContent = station.sub;

    text.append(name, sub);

    const badge = document.createElement('span');
    badge.className = 'card__badge';
    badge.textContent = station.badge;

    button.append(text, badge);
    li.appendChild(button);
    els.stations.appendChild(li);
  });
}

function render() {
  const station = currentStation();

  els.nowName.textContent = station ? station.name : '—';
  els.nowSub.textContent = station ? station.sub : 'Pick a station';

  // A class, not the `hidden` attribute: `hidden` is an HTMLElement property
  // and these two icons are SVG elements, where setting it does nothing.
  const playing = state.status === 'loading' || state.status === 'live';
  els.iconPlay.classList.toggle('is-hidden', playing);
  els.iconPause.classList.toggle('is-hidden', !playing);
  els.playpause.setAttribute('aria-label', playing ? 'Pause' : 'Play');

  els.prev.disabled = !station;
  els.next.disabled = !station;

  renderStations();
}

/* -- 5. the single <audio> element ---------------------------------------- */
/* There is exactly one <audio> for the whole app. Switching stations swaps
 * its .src — we never create a second element, because iOS only keeps the
 * lock-screen/background audio session attached to the element the user
 * originally started. */

async function loadAndPlay(station) {
  const loadId = ++state.loadId;
  state.retried = false;
  setStatus('loading');
  log('resolving stream for ' + station.name + ' (' + station.badge + ')');

  let url;
  try {
    url = await station.getStreamUrl();
  } catch (err) {
    if (loadId !== state.loadId) return;
    log('getStreamUrl() failed: ' + err.message);
    setStatus('error');
    return;
  }

  if (loadId !== state.loadId) {
    log('ignoring stale stream URL for ' + station.name);
    return;
  }
  if (!url) {
    log('getStreamUrl() returned nothing for ' + station.name);
    setStatus('error');
    return;
  }

  log('stream url: ' + url);
  audio.src = url;
  audio.load();
  startPlayback();
}

function startPlayback() {
  const attemptId = ++state.attemptId;
  const playing = audio.play();
  if (!playing || !playing.catch) return;

  playing.catch((err) => {
    // Autoplay policies reject here when play() wasn't user-initiated.
    // Network/decoder failures come through the 'error' event instead, and
    // that rejection can land *after* we've already retried — so ignore it
    // unless it belongs to the attempt currently in flight.
    if (attemptId !== state.attemptId) return;
    if (err && err.name === 'AbortError') return;
    log('play() rejected: ' + err.name + ' — ' + err.message);
    if (state.status !== 'error') setStatus('paused');
  });
}

// One retry per load: streams die and tokens expire, so ask the adapter for a
// fresh URL before giving up. If the retry fails too, stop and show 'error'.
async function retryOnce(station) {
  state.retried = true;
  const loadId = state.loadId;
  log('retrying ' + station.name + ' with a fresh stream url');

  let url;
  try {
    url = await station.getStreamUrl();
  } catch (err) {
    if (loadId !== state.loadId) return;
    log('retry getStreamUrl() failed: ' + err.message);
    setStatus('error');
    return;
  }

  if (loadId !== state.loadId) return;
  if (!url) {
    log('retry returned no url');
    setStatus('error');
    return;
  }

  log('retry stream url: ' + url);
  audio.src = url;
  audio.load();
  startPlayback();
}

audio.addEventListener('error', () => {
  const station = currentStation();
  const err = audio.error;
  log('audio error: ' + (err ? 'code ' + err.code : 'unknown') + (err && err.message ? ' — ' + err.message : ''));

  if (!station) {
    setStatus('error');
    return;
  }
  if (state.retried) {
    log('already retried once — giving up');
    setStatus('error');
    return;
  }
  retryOnce(station);
});

audio.addEventListener('playing', () => setStatus('live'));
audio.addEventListener('waiting', () => { if (state.status === 'live') setStatus('loading'); });
audio.addEventListener('stalled', () => log('stream stalled'));
audio.addEventListener('pause', () => {
  // load() resets the element and can fire a spurious 'pause' — ignore those.
  if (audio.readyState === 0) return;
  if (state.status !== 'error') setStatus('paused');
});

/* -- 6. station selection + transport ------------------------------------- */

function selectStation(index) {
  const station = STATIONS[index];
  if (!station) return;

  state.index = index;
  log('selected ' + station.name);
  render();
  updateMediaSession();
  loadAndPlay(station);
}

function play() {
  const station = currentStation();
  if (!station) {
    selectStation(0);
    return;
  }
  // No src yet, or we bailed out with an error — do a full (re)load.
  if (!audio.src || state.status === 'error') {
    loadAndPlay(station);
    return;
  }
  log('resume');
  setStatus('loading');
  startPlayback();
}

function pause() {
  if (!audio.src) return;
  log('pause');
  audio.pause();
}

function togglePlay() {
  if (state.status === 'live' || state.status === 'loading') pause();
  else play();
}

function step(delta) {
  if (state.index < 0) {
    selectStation(0);
    return;
  }
  const next = (state.index + delta + STATIONS.length) % STATIONS.length;
  selectStation(next);
}

/* -- 7. MediaSession (lock screen / control center) ----------------------- */

function updateMediaSession() {
  if (!('mediaSession' in navigator)) return;

  const station = currentStation();
  if (!station) return;

  navigator.mediaSession.metadata = new MediaMetadata({
    title: station.name,
    artist: station.sub,
    album: 'Signal',
    artwork: [
      { src: './icons/icon-192.png', sizes: '192x192', type: 'image/png' },
      { src: './icons/icon-512.png', sizes: '512x512', type: 'image/png' }
    ]
  });
}

function setupMediaSession() {
  if (!('mediaSession' in navigator)) {
    log('mediaSession not supported');
    return;
  }
  navigator.mediaSession.setActionHandler('play', () => play());
  navigator.mediaSession.setActionHandler('pause', () => pause());
  navigator.mediaSession.setActionHandler('previoustrack', () => step(-1));
  navigator.mediaSession.setActionHandler('nexttrack', () => step(1));
  log('mediaSession handlers wired');
}

/* -- 8. UI wiring --------------------------------------------------------- */

els.playpause.addEventListener('click', togglePlay);
els.prev.addEventListener('click', () => step(-1));
els.next.addEventListener('click', () => step(1));
els.logClear.addEventListener('click', () => { els.log.innerHTML = ''; });

/* -- 9. service worker ---------------------------------------------------- */
/* Relative path on purpose: GitHub Pages project sites live at
 * /<repo>/signal-radio/, not at the domain root. */

function registerServiceWorker() {
  if (!('serviceWorker' in navigator)) {
    log('service worker not supported');
    return;
  }
  navigator.serviceWorker.register('./sw.js')
    .then((reg) => log('service worker registered (scope ' + reg.scope + ')'))
    .catch((err) => log('service worker failed: ' + err.message));
}

/* -- boot ----------------------------------------------------------------- */

render();
setupMediaSession();
log('Signal ready — ' + STATIONS.length + ' stations');
registerServiceWorker();
