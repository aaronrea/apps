/* ---------------------------------------------------------------------------
 * Cone — region filter + classification helpers
 *
 * Shared between scripts/fetch-storms.mjs (Node, decides what gets written to
 * data/*.json) and js/app.js (browser, decides how to label what's already
 * been written). Keeping this one file the single source of truth means the
 * bounding boxes, the keyword lists and the classification labels can never
 * drift between the two.
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
 * by the single "gulf" match.
 *
 * The last three are the late-season additions. From October on, genesis
 * shifts out of the tropical Atlantic and into the western Caribbean and
 * Gulf, usually off a Central American Gyre, and NHC's outlook then talks
 * about "a broad area of low pressure over Central America" or "the remnants
 * of an eastern Pacific system" reaching the Bay of Campeche — phrasing the
 * place-name list alone would miss until the system had a Gulf position. */
export const REGION_KEYWORDS = [
  'gulf', 'caribbean', 'florida', 'bahamas', 'yucatan', 'honduras',
  'campeche', 'windward', 'leeward', 'texas', 'louisiana', 'tampa',
  'central america', 'tehuantepec', 'eastern pacific'
];

/* The eastern Pacific outlook has no positions at all, so its disturbances
 * are kept purely by place name. The only Pacific coast that matters is the
 * stretch from Acapulco to Central America: a system there can cross the
 * isthmus (or seed a gyre twin) into the Bay of Campeche or the western
 * Caribbean. Baja, the Gulf of California and anything "southwest of
 * southwestern Mexico" are deliberately absent — those go west. */
export const PACIFIC_KEYWORDS = [
  'tehuantepec', 'southern mexico', 'oaxaca', 'chiapas', 'guatemala',
  'el salvador', 'central america', 'honduras', 'nicaragua', 'campeche',
  'gulf of america', 'gulf of mexico', 'caribbean'
];

function keywordMatcher(keywords) {
  const all = new RegExp(`\\b(${keywords.join('|')})\\b`, 'i');
  const each = keywords.map((kw) => ({ kw, re: new RegExp(`\\b${kw}\\b`) }));
  return {
    matchAll(text) {
      if (!text) return [];
      const lower = text.toLowerCase();
      return each.filter(({ re }) => re.test(lower)).map(({ kw }) => kw);
    },
    matchAny(text) {
      return all.test(text || '');
    }
  };
}

const REGION_MATCHER = keywordMatcher(REGION_KEYWORDS);
const PACIFIC_MATCHER = keywordMatcher(PACIFIC_KEYWORDS);

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
  return REGION_MATCHER.matchAll(text);
}

export function textMentionsRegion(text) {
  return REGION_MATCHER.matchAny(text);
}

export function matchPacificKeywords(text) {
  return PACIFIC_MATCHER.matchAll(text);
}

/* -- basins ---------------------------------------------------------------
 * CurrentStorms.json ids are "al142024" / "ep152026" / "cp012026": the two-
 * letter prefix is the basin the system was *designated* in, which survives
 * a crossing (since 2000 a storm keeps its name and id across Central
 * America). The bin number ("EP5", "CP1") is only where NHC is filing the
 * advisories right now — Norbert, designated ep14, was binned CP1 once it
 * passed 140W — so the id is the one to trust. */
export function stormBasin(idOrStorm) {
  const storm = typeof idOrStorm === 'object' && idOrStorm ? idOrStorm : { id: idOrStorm };
  const src = (storm.id || storm.binNumber || '').toString().slice(0, 2).toUpperCase();
  return /^(AL|EP|CP)$/.test(src) ? src : null;
}

/* -- Pacific crossover watch --------------------------------------------------
 * The Pacific side of the Central American isthmus, Acapulco to Costa Rica.
 * An eastern Pacific system here is the only kind that can cross into the Bay
 * of Campeche or the western Caribbean (TD Eleven-E -> Hermine, 2010) or
 * mark the Pacific lobe of a Central American Gyre whose Atlantic lobe forms
 * a Gulf storm (John / Helene / Milton, 2024). West of 100W a landfalling
 * storm hits central Mexico and dies over the Sierra Madre; north of 18N on
 * this side of 100W is already the Gulf.
 *
 * REGION_BOX overlaps this box (its west edge, 98W, is east of Acapulco), so
 * without the basin check a storm in the Gulf of Tehuantepec would read as
 * "in your regions". It isn't — it's on the other coast. */
export const PACIFIC_CROSSOVER_BOX = { minLat: 8, maxLat: 18, minLon: -100, maxLon: -77 };

/* "Exclusively west" — the harmless heading. Everything from WNW round
 * through north and east to south-west is a coast-bound or stalled motion
 * when the storm is already this close to land. */
const WESTWARD_MIN_DEG = 225;
const WESTWARD_MAX_DEG = 290;
const STALLED_MPH = 5;

export function isPacificSide(storm) {
  const basin = stormBasin(storm);
  return (basin === 'EP' || basin === 'CP') && isInRegionBox(storm.lat, storm.lon, PACIFIC_CROSSOVER_BOX);
}

/* Why a Pacific-side storm is on watch, as a short phrase for the UI, or null
 * when it is simply heading west and out of the picture. Unknown motion
 * counts as a reason: NHC omits it in the first advisory or two, exactly
 * when a system this close to the coast is least predictable. */
export function crossoverReason(storm) {
  if (!isPacificSide(storm)) return null;

  const dir = storm.movementDir;
  const speed = storm.movementSpeed;
  const hasDir = typeof dir === 'number' && Number.isFinite(dir);
  const hasSpeed = typeof speed === 'number' && Number.isFinite(speed);

  if (hasSpeed && speed <= STALLED_MPH) return speed === 0 ? 'stationary near the coast' : 'nearly stationary near the coast';
  if (!hasDir) return 'motion not yet known';

  const d = ((dir % 360) + 360) % 360;
  if (d >= WESTWARD_MIN_DEG && d <= WESTWARD_MAX_DEG) return null;
  return 'not moving west';
}

export function isCrossoverWatch(storm) {
  return crossoverReason(storm) !== null;
}

/* -- Central American Gyre note ------------------------------------------------
 * The gyre's signature is development flagged on both sides of the isthmus at
 * once — the pattern that produced Helene, John and then Milton inside a
 * fortnight in 2024. Worth a line on the banner even when neither side is a
 * threat yet. "Both sides" means: something on the Pacific watch (a storm or
 * an outlook area), and an Atlantic outlook area kept by a western-Caribbean/
 * Gulf/Central-America keyword rather than, say, Florida or the Bahamas. */
const GYRE_KEYWORDS = new Set(['central america', 'campeche', 'caribbean', 'yucatan', 'honduras', 'eastern pacific', 'tehuantepec']);

export function gyreNote({ inAreas = [], pacificAreas = [], watchStorms = [] }) {
  const pacificSide = pacificAreas.length + watchStorms.length;
  const atlanticSide = inAreas.filter((a) => (a.matchedKeywords || []).some((k) => GYRE_KEYWORDS.has(k)));
  if (pacificSide === 0 || atlanticSide.length === 0) return null;
  return 'Development flagged on both sides of Central America — a Central American Gyre pattern.';
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
