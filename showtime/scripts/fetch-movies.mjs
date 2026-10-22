#!/usr/bin/env node
/* ---------------------------------------------------------------------------
 * Showtime — movie fetcher
 *
 * Runs in GitHub Actions (see .github/workflows/showtime.yml) and rewrites
 * showtime/data/movies.json. Node built-ins only, no dependencies.
 *
 * filmsociety.org sends no CORS headers, so the browser cannot read it; the
 * fetch happens here and the page reads the committed file.
 *
 * SOURCE (verified live 2026-10-22)
 *   https://filmsociety.org/movies/ is the "Now Playing" grid. Each film is
 *     <div class="... mix loc-lwr loc-burns"> <a href="movie.cfm?filID=3435">
 *       <img src="..."> <p itemprop="name">Title</p>
 *       <ul class="theater-list"><li>Lakewood Ranch</li>...</ul>
 *   Lakewood Ranch is the `loc-lwr` class / the "Lakewood Ranch" list item.
 *
 * Never write a film we did not read: if the page can't be parsed, or parses
 * to zero films, keep the previous file and exit non-zero.
 * ------------------------------------------------------------------------- */

import { readFile, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const HERE = dirname(fileURLToPath(import.meta.url));
const DATA_FILE = join(HERE, '..', 'data', 'movies.json');
const BASE = 'https://filmsociety.org/movies/';
const UA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) ' +
  'AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36';

const decode = (s) => s
  .replace(/&amp;/g, '&').replace(/&#0?39;|&apos;/g, "'").replace(/&quot;/g, '"')
  .replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&#(\d+);/g, (_, n) => String.fromCharCode(+n))
  .replace(/\s+/g, ' ').trim();

export function parseMovies(html) {
  const films = [];
  for (const [, tag, chunk] of html.matchAll(/(<a\b[^>]*class="movie thumbnail"[^>]*>)([\s\S]*?)<\/a>/g)) {
    const href = /href="([^"]*movie\.cfm\?filID=\d+)"/.exec(tag);
    const title = /itemprop="name">([^<]+)</.exec(chunk);
    if (!href || !title) continue;
    const theaters = [...chunk.matchAll(/<li>([^<]+)<\/li>/g)].map((m) => decode(m[1]));
    if (!theaters.includes('Lakewood Ranch')) continue;
    films.push({ title: decode(title[1]), url: new URL(decode(href[1]), BASE).href });
  }
  return films;
}

async function main() {
  const res = await fetch(BASE, { headers: { 'user-agent': UA }, signal: AbortSignal.timeout(20000) });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const films = parseMovies(await res.text());
  if (!films.length) throw new Error('parsed zero Lakewood Ranch films — markup changed?');

  let prev = null;
  try { prev = JSON.parse(await readFile(DATA_FILE, 'utf8')); } catch { /* first run */ }
  const same = prev && JSON.stringify(prev.films) === JSON.stringify(films);
  const out = { updated: same ? prev.updated : new Date().toISOString(), source: BASE, films };
  await writeFile(DATA_FILE, JSON.stringify(out, null, 2) + '\n');
  console.log(`${films.length} films at Lakewood Ranch`);
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  main().catch((err) => { console.error(`Showtime fetch failed: ${err.message}`); process.exit(1); });
}
