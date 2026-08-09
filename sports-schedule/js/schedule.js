/* ---------------------------------------------------------------------------
 * Slate — dates, buckets, and formatting
 *
 * Everything here is pure and takes `now` and `timeZone` as arguments rather
 * than reading the clock, which is the only reason the tests can pin a date
 * and a zone and get a stable answer. `scripts/test-schedule.mjs` covers it.
 *
 * A "day key" is a plain calendar date, `YYYY-MM-DD`, in the viewer's zone.
 * Comparing games by key rather than by timestamp is what makes "today" mean
 * the day you are living in instead of the last 24 hours, and it is why an
 * 8:00 PM game does not roll into tomorrow for anyone west of the venue.
 * ------------------------------------------------------------------------- */

/* -- day keys -------------------------------------------------------------- */

/* en-CA formats as YYYY-MM-DD, which sorts and compares as a string. */
export function dayKey(date, timeZone) {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone, year: 'numeric', month: '2-digit', day: '2-digit'
  }).format(date);
}

/* Key arithmetic happens at noon UTC so that adding a day never lands on a
 * DST seam and comes back as the same date. */
export function shiftKey(key, days) {
  const d = new Date(`${key}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

/* -- formatting ------------------------------------------------------------ */

/* "7:00 PM EDT" — the zone is part of the answer, not decoration. A game with
 * no announced kickoff comes back from ESPN with a placeholder midnight, so
 * showing it as "12:00 AM" would be worse than admitting we don't know. */
export function formatTime(iso, timeZone, timeValid = true) {
  if (!timeValid) return 'Time TBD';
  return new Intl.DateTimeFormat('en-US', {
    timeZone, hour: 'numeric', minute: '2-digit', timeZoneName: 'short'
  }).format(new Date(iso));
}

/* The zone label on its own, for the one place that says it out loud. */
export function zoneLabel(date, timeZone) {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone, hour: 'numeric', timeZoneName: 'short'
  }).formatToParts(date);
  const zone = parts.find((p) => p.type === 'timeZoneName');
  return zone ? zone.value : '';
}

/* "Sat, Aug 15". Formatted from the key in UTC so the label can never drift a
 * day away from the bucket it titles. */
export function formatDay(key) {
  return new Intl.DateTimeFormat('en-US', {
    timeZone: 'UTC', weekday: 'short', month: 'short', day: 'numeric'
  }).format(new Date(`${key}T12:00:00Z`));
}

/* Today and tomorrow get names; everything else gets its date. */
export function dayLabel(key, todayKey) {
  if (key === todayKey) return 'Today';
  if (key === shiftKey(todayKey, 1)) return 'Tomorrow';
  return formatDay(key);
}

/* "just now" / "6m ago" / "3h ago" / "2d ago". Coarse on purpose: the only
 * question it answers is whether what you are looking at can be trusted. */
export function fmtAge(iso, now = new Date()) {
  const then = new Date(iso);
  if (Number.isNaN(then.getTime())) return 'unknown';

  const minutes = Math.round((now - then) / 60000);
  if (minutes < 1) return 'just now';
  if (minutes < 60) return `${minutes}m ago`;

  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours}h ago`;

  return `${Math.round(hours / 24)}d ago`;
}

/* -- bucketing ------------------------------------------------------------- */

/* Splits a flat list of games into the two sections the app shows.
 *
 * Games before today fall out entirely — this is an agenda, not a season
 * archive. `next` is the first game beyond the horizon, so an empty week can
 * still say when the wait ends rather than just "nothing". */
export function bucket(games, now, { timeZone, days = 7 } = {}) {
  const todayKey = dayKey(now, timeZone);
  const keys = [];
  for (let i = 1; i <= days; i++) keys.push(shiftKey(todayKey, i));
  const lastKey = keys.length ? keys[keys.length - 1] : todayKey;

  const sorted = [...games].sort(byStart);

  const today = [];
  const byDay = new Map(keys.map((key) => [key, []]));
  let next = null;

  for (const game of sorted) {
    const key = dayKey(new Date(game.start), timeZone);
    if (key === todayKey) today.push(game);
    else if (byDay.has(key)) byDay.get(key).push(game);
    else if (key > lastKey && !next) next = { game, key };
  }

  return {
    todayKey,
    today,
    upcoming: keys.map((key) => ({ key, games: byDay.get(key) })),
    next
  };
}

function byStart(a, b) {
  const diff = new Date(a.start) - new Date(b.start);
  /* Two games at the same instant would otherwise render in whichever order
   * the leagues happened to come back in, which changes between refreshes. */
  return diff !== 0 ? diff : a.id.localeCompare(b.id);
}

/* -- game read-outs -------------------------------------------------------- */

/* The one line that says what is happening right now, and how loudly to say
 * it. `tone` drives colour; nothing else in the app decides that. */
export function statusLine(game, timeZone) {
  if (game.state === 'in') {
    return { tone: 'live', text: game.detail || 'In progress' };
  }
  if (game.state === 'post') {
    return { tone: 'final', text: game.detail || 'Final' };
  }
  return { tone: 'pre', text: formatTime(game.start, timeZone, game.timeValid) };
}

/* "24–17" from the followed team's point of view, plus the W/L/T that a fan
 * actually reads first. Returns null until there is something to show. */
export function scoreLine(game) {
  if (!game.score || game.score.team === null || game.score.opponent === null) return null;

  const { team, opponent } = game.score;
  const result = game.state === 'post'
    ? (team > opponent ? 'W' : team < opponent ? 'L' : 'T')
    : null;

  return { result, text: `${team}–${opponent}` };
}
