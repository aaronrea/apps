/* Reads the committed movies.json for the landing card. */

export async function loadMovies(path) {
  const res = await fetch(`${path}?t=${Date.now()}`, { cache: 'no-store' });
  if (!res.ok) throw new Error(`${path}: HTTP ${res.status}`);
  const data = await res.json();
  return { updated: data.updated, films: Array.isArray(data.films) ? data.films : [] };
}

export function fmtAge(iso) {
  const ms = Date.now() - Date.parse(iso);
  if (!Number.isFinite(ms)) return 'at an unknown time';
  const min = Math.max(0, Math.round(ms / 60000));
  if (min < 60) return `${min}m ago`;
  const h = Math.round(min / 60);
  return h < 48 ? `${h}h ago` : `${Math.round(h / 24)}d ago`;
}
