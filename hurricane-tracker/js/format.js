/* ---------------------------------------------------------------------------
 * Cone — display formatting
 *
 * Pure functions, no DOM. Kept separate from app.js the same way Pump keeps
 * compare.js separate: formatting bugs (a wrong "ago", a wrong compass point)
 * should be testable without a browser.
 * ------------------------------------------------------------------------- */

const COMPASS = [
  'N', 'NNE', 'NE', 'ENE', 'E', 'ESE', 'SE', 'SSE',
  'S', 'SSW', 'SW', 'WSW', 'W', 'WNW', 'NW', 'NNW'
];

export function compassPoint(deg) {
  if (typeof deg !== 'number' || !Number.isFinite(deg)) return null;
  const idx = Math.round(((deg % 360) + 360) % 360 / 22.5) % 16;
  return COMPASS[idx];
}

export function fmtMovement(dir, speedKt) {
  if (typeof speedKt !== 'number' || !Number.isFinite(speedKt)) return 'Stationary or unknown';
  if (speedKt === 0) return 'Stationary';
  const point = compassPoint(dir);
  return point ? `${point} at ${speedKt} mph` : `${speedKt} mph`;
}

export function fmtWind(kt, mph) {
  if (typeof kt !== 'number' || !Number.isFinite(kt)) return 'Wind unknown';
  return mph != null ? `${kt} kt (${mph} mph)` : `${kt} kt`;
}

export function fmtPressure(mb) {
  return typeof mb === 'number' && Number.isFinite(mb) ? `${mb} mb` : null;
}

export function fmtCoords(lat, lon) {
  if (typeof lat !== 'number' || typeof lon !== 'number') return null;
  const ns = lat >= 0 ? 'N' : 'S';
  const ew = lon >= 0 ? 'E' : 'W';
  return `${Math.abs(lat).toFixed(1)}°${ns}, ${Math.abs(lon).toFixed(1)}°${ew}`;
}

const MIN = 60 * 1000;
const HOUR = 60 * MIN;
const DAY = 24 * HOUR;

/* "just now" / "2h ago" / "3d ago" — matches the granularity someone actually
 * cares about when the source only updates every ~6 hours. */
export function fmtAge(iso, now = Date.now()) {
  if (!iso) return 'unknown';
  const then = new Date(iso).getTime();
  if (!Number.isFinite(then)) return 'unknown';

  const ms = now - then;
  if (ms < 0) return 'just now';
  if (ms < MIN) return 'just now';
  if (ms < HOUR) return `${Math.floor(ms / MIN)}m ago`;
  if (ms < DAY) return `${Math.floor(ms / HOUR)}h ago`;
  return `${Math.floor(ms / DAY)}d ago`;
}

export function isStaleAge(iso, now = Date.now(), staleAfterMs = 8 * HOUR) {
  if (!iso) return true;
  const then = new Date(iso).getTime();
  if (!Number.isFinite(then)) return true;
  return (now - then) > staleAfterMs;
}
