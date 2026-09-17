/* ---------------------------------------------------------------------------
 * Cone — Tropical Weather Outlook parser
 *
 * NHC does not publish the outlook as JSON. The closest thing to structured
 * data is the RSS feed (index-at.xml for the Atlantic, index-ep.xml for the
 * eastern Pacific), whose first <item> wraps the same plain-text product NHC
 * posts at text/MIATWOAT.shtml / MIATWOEP.shtml, HTML-escaped and
 * <br />-broken instead of newline-broken. This parses that text into one
 * entry per disturbance. Both basins use the same shape.
 *
 * Real shape (verified live 2026-08-30 and 2026-09-15):
 *
 *   For the North Atlantic...Caribbean Sea and the Gulf of America:
 *
 *   Active Systems:
 *   The National Hurricane Center is issuing advisories on Hurricane ...
 *
 *   Northern Gulf of America (AL97):
 *   A low pressure area is located over the northern Gulf of America ...
 *   * Formation chance through 48 hours...medium...50 percent.
 *   * Formation chance through 7 days...medium...50 percent.
 *
 *   Central Subtropical Atlantic:
 *   A trough of low pressure located about 800 miles east-southeast of ...
 *   * Formation chance through 48 hours...low...near 0 percent.
 *   * Formation chance through 7 days...medium...40 percent.
 *
 *   $$
 *   Forecaster Beven
 *
 * Each disturbance heading is a line ending in ":". The parenthetical is
 * optional: a numbered invest gets "(AL97)", a leftover gets "(Remnants of
 * Dolly)", and a disturbance that is neither — most of them, early on — gets
 * nothing. The preamble ("For the North Atlantic...:") and the "Active
 * Systems:" paragraph end in a colon too, so what actually identifies a
 * disturbance is that its block carries the two "* Formation chance" bullets.
 * ------------------------------------------------------------------------- */

import { matchRegionKeywords } from './filter.js';

/* A line that ends in ":" and contains no sentence punctuation before it.
 * Body lines are wrapped prose and a wrapped line can end in a colon too
 * ("...should monitor its progress:"), so on its own this is not enough —
 * splitAreas also requires a blank line before a heading, which NHC puts
 * before every paragraph and never inside one. */
const HEADING_RE = /^([^.,]+?):\s*$/;
const PARENTHETICAL_RE = /^(.*?)\s*\(([^)]+)\)\s*$/;
const FORMATION_BULLET_RE = /^\*\s*Formation chance/i;
const FORMATION_RE = /Formation chance through (48 hours|7 days)\s*\.{3}\s*(\w+)\s*\.{3}\s*([^.]+)\./i;

/* Turns the RSS item's HTML description into the same plain text NHC's own
 * .shtml product shows: <br /> -> newline, then a decode of the handful of
 * entities NHC actually uses (it does not send exotic ones). */
export function htmlToText(html) {
  return html
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<[^>]+>/g, '')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/\r\n/g, '\n');
}

/* Splits the outlook body into one block of lines per heading, then keeps
 * only the blocks that are disturbances — the ones with formation-chance
 * bullets. Lines after "$$" (the forecaster sign-off) are dropped. */
function splitAreas(text) {
  const lines = text.split('\n').map((l) => l.trim());
  const blocks = [];
  let current = null;
  let afterBlank = true;

  for (const line of lines) {
    if (line === '$$') { current = null; continue; }
    const startsParagraph = afterBlank;
    afterBlank = line === '';
    const heading = startsParagraph ? line.match(HEADING_RE) : null;
    if (heading) {
      const label = heading[1].trim();
      const paren = label.match(PARENTHETICAL_RE);
      current = {
        heading: label,
        label: paren ? paren[1].trim() : label,
        tag: paren ? paren[2].trim() : null,
        lines: []
      };
      blocks.push(current);
      continue;
    }
    if (current && line) current.lines.push(line);
  }

  return blocks.filter((b) => b.lines.some((l) => FORMATION_BULLET_RE.test(l)));
}

function parseFormation(lines, hoursLabel) {
  for (const line of lines) {
    const m = line.match(FORMATION_RE);
    if (m && m[1].toLowerCase() === hoursLabel) {
      return { category: m[2].toLowerCase(), percent: m[3].trim() };
    }
  }
  return null;
}

/* An invest bin looks like "AL97" — two letters (basin) + two digits. A plain
 * description in the parens ("Remnants of Dolly") never matches this. */
const BIN_RE = /^[A-Z]{2}\d{2}$/;

/* NHC states motion as "moves/moving [slowly] northward", "drifts
 * northeastward", "moves west-northwestward at 10 to 15 mph". Captured as a
 * plain phrase for display: a Pacific-side disturbance "moving northward" is
 * the crossover hint, and there is no position or vector to compute it from. */
const MOTION_RE = /\b(?:moves?|moving|drifts?|drifting|meanders?|meandering)\s+(?:\w+ly\s+|little\s+)?((?:north|south|east|west)(?:-?(?:north|south|east|west)){0,2}ward)/i;

export function outlookMotion(text) {
  const m = (text || '').match(MOTION_RE);
  return m ? m[1].toLowerCase() : null;
}

/* `matcher` decides which place names keep an area: the Atlantic feed uses
 * the region keywords, the eastern Pacific feed the crossover ones. Either
 * way the result lands in `inRegion` so the fetcher and page treat the two
 * files alike. */
export function parseOutlook(text, matcher = matchRegionKeywords) {
  const areas = splitAreas(text);

  return areas.map((area, index) => {
    const bodyLines = area.lines.filter((l) => !FORMATION_BULLET_RE.test(l));
    const body = bodyLines.join(' ').replace(/\s+/g, ' ').trim();
    const searchText = `${area.label} ${body}`;
    const keywords = matcher(searchText);

    return {
      id: `outlook-${index + 1}`,
      area: area.label,
      descriptor: area.tag,
      binNumber: area.tag && BIN_RE.test(area.tag) ? area.tag : null,
      text: body,
      motion: outlookMotion(body),
      formationChance48h: parseFormation(area.lines, '48 hours'),
      formationChance7d: parseFormation(area.lines, '7 days'),
      inRegion: keywords.length > 0,
      matchedKeywords: keywords
    };
  });
}
