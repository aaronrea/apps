/* ---------------------------------------------------------------------------
 * Cone — region filter + classification helpers
 *
 * Shared between scripts/fetch-storms.mjs (Node, decides what gets written to
 * data/*.json) and js/app.js (browser, decides how to label what's already
 * been written). Keeping this one file the single source of truth means the
 * bounding box and the classification labels can never drift between the two.
 *
 * REGION_BOX is one combined box — Gulf of America/Mexico, the western
 * Caribbean/Honduras, the Texas coast, and the Florida/Bahamas approach — plus
 * enough open Atlantic to catch a storm before it reaches any of them, not
 * just once it arrives.
 * ------------------------------------------------------------------------- */

export const REGION_BOX = { minLat: 8, maxLat: 31, minLon: -98, maxLon: -60 };

/* Early invests often have no lat/lon yet, only prose. This is the fallback:
 * match the outlook text itself against the places that matter. "Gulf of
 * America" is NOAA's current name for the Gulf of Mexico — both are covered
 * by the single "gulf" match. */
export const REGION_KEYWORDS = [
  'gulf', 'caribbean', 'florida', 'bahamas', 'yucatan', 'honduras',
  'campeche', 'windward', 'leeward', 'texas', 'louisiana', 'tampa'
];

const REGION_KEYWORD_RE = new RegExp(`\\b(${REGION_KEYWORDS.join('|')})\\b`, 'i');

export function isInRegionBox(lat, lon, box = REGION_BOX) {
  if (typeof lat !== 'number' || typeof lon !== 'number' || !Number.isFinite(lat) || !Number.isFinite(lon)) {
    return false;
  }
  return lat >= box.minLat && lat <= box.maxLat && lon >= box.minLon && lon <= box.maxLon;
}

/* Returns the matched keywords (lowercase), or an empty array. Checking every
 * keyword rather than stopping at the first match lets the UI show *why* an
 * outlook area was kept. */
export function matchRegionKeywords(text) {
  if (!text) return [];
  const lower = text.toLowerCase();
  return REGION_KEYWORDS.filter((kw) => new RegExp(`\\b${kw}\\b`).test(lower));
}

export function textMentionsRegion(text) {
  return REGION_KEYWORD_RE.test(text || '');
}

/* -- classification --------------------------------------------------------
 * NHC's `classification` codes, in the order the dashboard should rank them:
 * a hurricane in the region outranks everything else on screen. PTC (post-
 * tropical) sits last — the system is winding down, not building. */
export const CLASSIFICATIONS = {
  HU:  { label: 'Hurricane',              tone: 'bad',  rank: 5 },
  STS: { label: 'Subtropical Storm',      tone: 'warn', rank: 4 },
  TS:  { label: 'Tropical Storm',         tone: 'warn', rank: 4 },
  STD: { label: 'Subtropical Depression', tone: 'info', rank: 3 },
  TD:  { label: 'Tropical Depression',    tone: 'info', rank: 3 },
  PTC: { label: 'Post-Tropical Cyclone',  tone: 'muted', rank: 1 }
};

export function classificationInfo(code) {
  return CLASSIFICATIONS[code] || { label: code || 'Unknown', tone: 'muted', rank: 0 };
}

export function ktToMph(kt) {
  return typeof kt === 'number' && Number.isFinite(kt) ? Math.round(kt * 1.15078) : null;
}

/* -- formation chance (outlook areas) --------------------------------------
 * NHC phrases these as a category word ("low"/"medium"/"high") plus a percent
 * phrase ("near 0 percent", "50 percent"). The category is what the UI colours
 * — the percent phrase is shown verbatim since "near 0" and "0" read
 * differently to a reader deciding whether to worry. */
export function formationTone(category) {
  const key = (category || '').toLowerCase();
  if (key === 'high') return 'bad';
  if (key === 'medium') return 'warn';
  if (key === 'low') return 'info';
  return 'muted';
}
