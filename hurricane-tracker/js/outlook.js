/* ---------------------------------------------------------------------------
 * Cone — Tropical Weather Outlook parser
 *
 * NHC does not publish the outlook as JSON. The closest thing to structured
 * data is the Atlantic RSS feed (index-at.xml), whose one <item> wraps the
 * same plain-text product NHC posts at text/MIATWOAT.shtml, HTML-escaped and
 * <br />-broken instead of newline-broken. This parses that text into one
 * entry per disturbance.
 *
 * Real shape (verified live 2026-08-30):
 *
 *   For the North Atlantic...Caribbean Sea and the Gulf of America:
 *
 *   Northern Gulf of America (AL97):
 *   A low pressure area is located over the northern Gulf of America ...
 *   * Formation chance through 48 hours...medium...50 percent.
 *   * Formation chance through 7 days...medium...50 percent.
 *
 *   Near Puerto Rico and the Virgin Islands (Remnants of Dolly):
 *   ...
 *
 *   $$
 *   Forecaster Beven
 *
 * Each disturbance heading is a line ending in "):" — the text before the
 * parenthesis is the area name, the text inside it is either an invest bin
 * (AL97) or a plain description (Remnants of Dolly). The heading, its body
 * paragraph and its two formation-chance bullets run until the next heading
 * or the "$$" sign-off.
 * ------------------------------------------------------------------------- */

import { matchRegionKeywords } from './filter.js';

const HEADING_RE = /^(.+\(([^)]+)\)):\s*$/;
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

/* Splits the outlook body into one block of lines per disturbance heading.
 * Lines before the first heading (the "For the North Atlantic...:" preamble)
 * and after "$$" (the forecaster sign-off) are dropped. */
function splitAreas(text) {
  const lines = text.split('\n').map((l) => l.trim());
  const areas = [];
  let current = null;

  for (const line of lines) {
    if (line === '$$') { current = null; continue; }
    const heading = line.match(HEADING_RE);
    if (heading) {
      current = { heading: heading[1], label: heading[1].trim(), tag: heading[2].trim(), lines: [] };
      areas.push(current);
      continue;
    }
    if (current && line) current.lines.push(line);
  }

  return areas;
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

export function parseOutlook(text) {
  const areas = splitAreas(text);

  return areas.map((area, index) => {
    const bodyLines = area.lines.filter((l) => !/^\*\s*Formation chance/i.test(l));
    const body = bodyLines.join(' ').replace(/\s+/g, ' ').trim();
    const searchText = `${area.label} ${body}`;
    const keywords = matchRegionKeywords(searchText);

    return {
      id: `outlook-${index + 1}`,
      area: area.label.replace(/\s*\([^)]*\)\s*$/, ''),
      descriptor: area.tag,
      binNumber: BIN_RE.test(area.tag) ? area.tag : null,
      text: body,
      formationChance48h: parseFormation(area.lines, '48 hours'),
      formationChance7d: parseFormation(area.lines, '7 days'),
      inRegion: keywords.length > 0,
      matchedKeywords: keywords
    };
  });
}
