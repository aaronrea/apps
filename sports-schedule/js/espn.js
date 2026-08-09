/* ---------------------------------------------------------------------------
 * Slate — the ESPN adapter
 *
 * The page fetches ESPN directly. That is worth stating plainly because the
 * sibling app in this repo does the opposite: Pump has to scrape in GitHub
 * Actions because gas stations send no CORS headers. ESPN's site API sends
 * `access-control-allow-origin: *` on every one of these endpoints (verified
 * 2026-08-09), so there is no workflow here and no committed data file — the
 * browser is allowed to ask, so it asks.
 *
 * The endpoint is ESPN's public site API. It is undocumented and unversioned,
 * which is the standing risk: it can change shape without notice. Everything
 * below therefore reads defensively and drops a game it cannot understand
 * rather than rendering half of one.
 *
 * Shape, for the next person reading this:
 *   events[] → competitions[0] → competitors[] (home + away)
 *                              → broadcasts[]  (channels, incl. streaming)
 *                              → status.type   (pre / in / post)
 * ------------------------------------------------------------------------- */

import { SEASON_TYPES } from './teams.js';

const BASE = 'https://site.api.espn.com/apis/site/v2/sports';

export function scheduleUrl(team, seasonType) {
  return `${BASE}/${team.path}/teams/${team.espnId}/schedule?seasontype=${seasonType}`;
}

/* -- fetching -------------------------------------------------------------- */

/* One team, all season types, merged.
 *
 * Season types are requested separately because ESPN will not return more than
 * one at a time, and they are merged by event id because preseason and regular
 * season do occasionally repeat a game across responses.
 *
 * A season type that fails is not an error: type 3 is empty until a postseason
 * exists, and a single 5xx should not blank a team. This resolves with whatever
 * came back and reports the failures, and only calls the team failed when
 * nothing at all did. */
export async function fetchTeam(team, { fetchImpl = fetch, signal } = {}) {
  const results = await Promise.all(SEASON_TYPES.map(async (seasonType) => {
    try {
      const response = await fetchImpl(scheduleUrl(team, seasonType), {
        signal, cache: 'no-store'
      });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      return { ok: true, games: normalize(await response.json(), team) };
    } catch (error) {
      return { ok: false, error };
    }
  }));

  const games = new Map();
  for (const result of results) {
    if (!result.ok) continue;
    for (const game of result.games) games.set(game.id, game);
  }

  const failed = results.filter((r) => !r.ok);
  return {
    games: [...games.values()],
    /* Every request failing is the only case the UI needs to hear about. */
    error: failed.length === results.length ? failed[0].error : null
  };
}

/* All teams, in parallel, each isolated. One league going down must not take
 * the other two off the screen — the same rule the gas app fetches by. */
export async function fetchAll(teams, options = {}) {
  const settled = await Promise.all(teams.map(async (team) => {
    const { games, error } = await fetchTeam(team, options);
    return { team, games, error };
  }));

  return {
    games: settled.flatMap((s) => s.games),
    failures: settled.filter((s) => s.error).map((s) => ({ team: s.team, error: s.error }))
  };
}

/* -- normalising ----------------------------------------------------------- */

/* Raw ESPN payload → the flat game shape the rest of the app knows about.
 * Pure, so the tests can hand it a fixture. */
export function normalize(payload, team) {
  const events = payload && Array.isArray(payload.events) ? payload.events : [];
  return events.map((event) => normalizeEvent(event, team)).filter(Boolean);
}

function normalizeEvent(event, team) {
  const competition = event && event.competitions && event.competitions[0];
  if (!competition || !Array.isArray(competition.competitors)) return null;

  const mine = competition.competitors.find((c) => c.team && c.team.id === team.espnId);
  const theirs = competition.competitors.find((c) => c !== mine && c.team);
  /* A game we are not in, or with only one side listed, tells us nothing. */
  if (!mine || !theirs) return null;

  const start = competition.date || event.date;
  if (!start) return null;

  const status = (competition.status && competition.status.type) || {};

  return {
    id: String(event.id),
    teamId: team.id,
    league: team.league,
    accent: team.accent,

    start,
    /* ESPN flags an unannounced kickoff here and parks the date at midnight. */
    timeValid: event.timeValid !== false,

    home: mine.homeAway === 'home',
    neutral: competition.neutralSite === true,

    team: sideOf(mine, team.name),
    opponent: sideOf(theirs),

    venue: venueOf(competition),
    broadcasts: broadcastsOf(competition),

    state: status.state || 'pre',
    detail: status.shortDetail || status.detail || status.description || '',
    score: scoreOf(mine, theirs),

    link: linkOf(event),
    /* Bowl games, rivalry names, playoff round — ESPN puts them here and they
     * are the most interesting thing about the game when they exist. */
    note: noteOf(event, competition)
  };
}

function sideOf(competitor, override) {
  const team = competitor.team || {};
  return {
    name: override || team.shortDisplayName || team.displayName || team.name || 'TBD',
    abbr: team.abbreviation || '',
    logo: logoOf(team),
    rank: rankOf(competitor)
  };
}

/* ESPN ships several cuts of every mark. The `default` one is the full-colour
 * logo; the `dark` one is a flat white silhouette meant for dark backgrounds.
 * This app takes the colour version and puts it on a light chip instead —
 * losing the team's actual colours is a bad trade for a screen whose whole
 * point is recognising a matchup at a glance. */
function logoOf(team) {
  const logos = Array.isArray(team.logos) ? team.logos : [];
  const preferred = logos.find((l) => Array.isArray(l.rel) && l.rel.includes('default'));
  const href = (preferred && preferred.href) || (logos[0] && logos[0].href) || team.logo || null;
  return href ? thumbnail(href) : null;
}

/* The directory is called `500` but it does not promise 500 pixels: the Jets
 * mark on that path is a 4096px, 130KB PNG. A card full of those is most of a
 * megabyte of images to draw six 34px chips.
 *
 * ESPN's own combiner resizes on the way out — the same Jets logo is 1.4KB at
 * 80px — so every mark is requested at the size it will actually be drawn.
 * Only `/i/` paths are rewritten; anything else is passed through untouched
 * rather than guessed at. */
const LOGO_PX = 68; // 2x the 34px chip, for retina

function thumbnail(href) {
  try {
    const url = new URL(href);
    if (url.hostname !== 'a.espncdn.com' || !url.pathname.startsWith('/i/')) return href;
    return `https://a.espncdn.com/combiner/i?img=${url.pathname}&w=${LOGO_PX}&h=${LOGO_PX}`;
  } catch (error) {
    /* Not an absolute URL — leave it alone and let the <img> decide. */
    return href;
  }
}

/* Only the AP-style number, and only when there is one. */
function rankOf(competitor) {
  const rank = competitor.curatedRank && competitor.curatedRank.current;
  return typeof rank === 'number' && rank > 0 && rank < 26 ? rank : null;
}

function venueOf(competition) {
  const venue = competition.venue;
  if (!venue) return null;
  const address = venue.address || {};
  const where = [address.city, address.state].filter(Boolean).join(', ');
  return { name: venue.fullName || '', where };
}

/* Channels, deduped by name. `kind` separates a TV channel from a streaming
 * service because they answer different questions ("what do I put on" versus
 * "what do I open"), and `market` matters because a Home-market entry is the
 * regional broadcast — the one that may be dark where you are. */
function broadcastsOf(competition) {
  const raw = Array.isArray(competition.broadcasts) ? competition.broadcasts : [];
  const seen = new Set();
  const out = [];

  for (const entry of raw) {
    const name = entry && entry.media && entry.media.shortName;
    if (!name || seen.has(name)) continue;
    seen.add(name);

    const kind = String((entry.type && entry.type.shortName) || '').toLowerCase();
    out.push({
      name,
      kind: kind === 'streaming' ? 'streaming' : kind === 'radio' ? 'radio' : 'tv',
      market: (entry.market && entry.market.type) || 'National'
    });
  }

  /* Radio last; it is the fallback, not the plan. */
  return out.sort((a, b) => Number(a.kind === 'radio') - Number(b.kind === 'radio'));
}

/* Scores are told from the followed team's side, so a card never asks you to
 * work out which number is yours. */
function scoreOf(mine, theirs) {
  const team = scoreValue(mine.score);
  const opponent = scoreValue(theirs.score);
  return team === null && opponent === null ? null : { team, opponent };
}

/* The field is `{value, displayValue}` on some responses and a bare string on
 * others, and 0 is a real score — hence the explicit null checks. */
function scoreValue(score) {
  if (score === null || score === undefined) return null;
  const raw = typeof score === 'object' ? score.value ?? score.displayValue : score;
  const value = Number(raw);
  return Number.isFinite(value) ? value : null;
}

function linkOf(event) {
  const links = Array.isArray(event.links) ? event.links : [];
  const web = links.find((l) => Array.isArray(l.rel)
    && l.rel.includes('desktop') && l.rel.includes('event') && l.href);
  return (web && web.href) || null;
}

function noteOf(event, competition) {
  const notes = (Array.isArray(event.notes) && event.notes.length ? event.notes : competition.notes) || [];
  const headline = notes.find((n) => n && n.headline);
  return headline ? headline.headline : null;
}
