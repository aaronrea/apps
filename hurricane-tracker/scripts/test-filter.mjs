#!/usr/bin/env node
/* ---------------------------------------------------------------------------
 * Cone — tests for the region filter and outlook parser
 *
 * No framework, no dependencies: node scripts/test-filter.mjs
 *
 * The fixtures are real NHC RSS responses, not made-up shapes:
 *   outlook-sample.xml          Atlantic, 2026-08-30: a Gulf invest near the
 *                               Louisiana/Texas coast + the remnants of Dolly
 *                               near Puerto Rico. Both headings carry a
 *                               parenthetical.
 *   outlook-plain-heading.xml   Atlantic, 2026-09-15: one disturbance whose
 *                               heading has no parenthetical — the shape that
 *                               the original parser silently dropped.
 *   outlook-pacific-sample.xml  Eastern Pacific, 2026-09-15: three
 *                               disturbances, an "Active Systems:" paragraph,
 *                               none near Central America.
 * ------------------------------------------------------------------------- */

import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import {
  isInRegionBox, matchRegionKeywords, textMentionsRegion, matchPacificKeywords,
  classificationInfo, ktToMph, formationTone, REGION_BOX, PACIFIC_CROSSOVER_BOX,
  stormBasin, isPacificSide, crossoverReason, isCrossoverWatch, gyreNote
} from '../js/filter.js';
import { htmlToText, parseOutlook, outlookMotion } from '../js/outlook.js';
import { localizeGulf } from '../js/format.js';

const HERE = dirname(fileURLToPath(import.meta.url));

let passed = 0;
let failed = 0;

function check(label, actual, expected) {
  const a = JSON.stringify(actual);
  const e = JSON.stringify(expected);
  if (a === e) {
    passed += 1;
  } else {
    failed += 1;
    console.error(`FAIL ${label}\n  expected: ${e}\n  actual:   ${a}`);
  }
}

function ok(label, cond) {
  check(label, !!cond, true);
}

/* -- isInRegionBox ---------------------------------------------------------- */

ok('Tampa is in region', isInRegionBox(27.9, -82.5));
ok('Houston/Galveston is in region', isInRegionBox(29.3, -94.8));
ok('Roatan, Honduras is in region', isInRegionBox(16.3, -86.5));
ok('open Atlantic approach (east of Bahamas) is in region', isInRegionBox(24, -65));
ok('east Pacific storm off Mexico is NOT in region', !isInRegionBox(17.2, -123.2));
ok('North Atlantic, too far north, is NOT in region', !isInRegionBox(45, -40));
ok('south of the box is NOT in region', !isInRegionBox(5, -80));

// boundary: exactly on the edges counts as in
check('min corner is inclusive', isInRegionBox(REGION_BOX.minLat, REGION_BOX.minLon), true);
check('max corner is inclusive', isInRegionBox(REGION_BOX.maxLat, REGION_BOX.maxLon), true);
check('just outside minLat is excluded', isInRegionBox(REGION_BOX.minLat - 0.1, -90), false);

// missing/invalid coordinates (invest with no fix yet) never crash and never match
check('null lat is not in region', isInRegionBox(null, -90), false);
check('undefined lon is not in region', isInRegionBox(20, undefined), false);
check('NaN is not in region', isInRegionBox(NaN, -90), false);

/* -- keyword matching -------------------------------------------------------- */

check('matches "Gulf of America"', matchRegionKeywords('over the northern Gulf of America'), ['gulf']);
check('matches multiple keywords', matchRegionKeywords('Texas and Louisiana coasts'), ['texas', 'louisiana']);
ok('"Honduras" text mentions region', textMentionsRegion('near the coast of Honduras'));
ok('open-Atlantic text with no place name does not mention region', !textMentionsRegion('several hundred miles east of the Lesser Antilles'));
check('empty text matches nothing', matchRegionKeywords(''), []);
// word-boundary: "galveston" alone should not false-match on a substring of some other keyword
check('no accidental substring match', matchRegionKeywords('a system near Galveston'), []);
// late-season phrasing: a gyre over Central America, or Pacific remnants, before there is a Gulf position
check('matches "Central America" (gyre phrasing)', matchRegionKeywords('a broad area of low pressure over Central America'), ['central america']);
check('matches Pacific-remnant phrasing', matchRegionKeywords('the remnants of an eastern Pacific system over the Isthmus of Tehuantepec'), ['tehuantepec', 'eastern pacific']);

/* -- Pacific keyword matching (eastern Pacific outlook) ---------------------- */

check('Pacific: Tehuantepec matches', matchPacificKeywords('over the Gulf of Tehuantepec'), ['tehuantepec']);
check('Pacific: southern Mexico + Guatemala', matchPacificKeywords('near the coasts of southern Mexico and Guatemala'), ['southern mexico', 'guatemala']);
check('Pacific: "southwestern Mexico" (Acapulco and west) does NOT match', matchPacificKeywords('well offshore of southwestern Mexico'), []);
check('Pacific: Gulf of California does NOT match', matchPacificKeywords('over the southern Gulf of California'), []);
check('Pacific: Baja does NOT match', matchPacificKeywords('south of the Baja California peninsula'), []);

/* -- basin ------------------------------------------------------------------ */

check('basin from id: Atlantic', stormBasin({ id: 'al142024', binNumber: 'AT4' }), 'AL');
check('basin from id: eastern Pacific', stormBasin({ id: 'ep152026', binNumber: 'EP5' }), 'EP');
check('basin from id beats bin (Norbert: ep14 filed as CP1)', stormBasin({ id: 'ep142026', binNumber: 'CP1' }), 'EP');
check('basin from bin when id missing', stormBasin({ id: null, binNumber: 'EP5' }), 'EP');
check('basin unknown', stormBasin({ id: 'xx', binNumber: null }), null);

/* -- Pacific crossover watch ----------------------------------------------------
 * The rule: eastern Pacific system, on the Acapulco-to-Central-America coast,
 * and not simply heading west. Cases modelled on the real crossovers. */

// TD Eleven-E, 2010-09-03: near Salina Cruz moving NW, crossed to become Hermine
const elevenE = { id: 'ep112010', lat: 15.8, lon: -95.5, movementDir: 315, movementSpeed: 7 };
ok('Eleven-E (Tehuantepec, NW) is Pacific side', isPacificSide(elevenE));
ok('Eleven-E is on crossover watch', isCrossoverWatch(elevenE));
check('Eleven-E reason', crossoverReason(elevenE), 'not moving west');
ok('Eleven-E is NOT in region (Pacific coast, despite being inside REGION_BOX)', isInRegionBox(elevenE.lat, elevenE.lon) && !isPacificSide(elevenE) === false);

// Hurricane John, 2024-09-23: off Guerrero moving N into the coast
const john = { id: 'ep102024', lat: 15.9, lon: -98.6, movementDir: 360, movementSpeed: 7 };
ok('John (Guerrero, N) is on crossover watch', isCrossoverWatch(john));

// Today's Fifteen-E: far offshore at 124W moving W — not our coast, not flagged
const fifteenE = { id: 'ep152026', lat: 16.1, lon: -123.9, movementDir: 260, movementSpeed: 12 };
ok('Fifteen-E (124W, W) is not Pacific side', !isPacificSide(fifteenE));
ok('Fifteen-E is not on watch', !isCrossoverWatch(fifteenE));

// On our coast but heading exclusively west: harmless
const westbound = { id: 'ep092026', lat: 13.5, lon: -93, movementDir: 275, movementSpeed: 12 };
ok('westbound storm on the coast is Pacific side', isPacificSide(westbound));
ok('westbound storm on the coast is NOT on watch', !isCrossoverWatch(westbound));
check('westbound reason is null', crossoverReason(westbound), null);
ok('WSW (250) counts as west', !isCrossoverWatch({ ...westbound, movementDir: 250 }));
ok('WNW (290) counts as west', !isCrossoverWatch({ ...westbound, movementDir: 290 }));
ok('NW (315) does not count as west', isCrossoverWatch({ ...westbound, movementDir: 315 }));
ok('SW (220) does not count as west', isCrossoverWatch({ ...westbound, movementDir: 220 }));
ok('E (90) is on watch', isCrossoverWatch({ ...westbound, movementDir: 90 }));

// Stalled near the coast: the gyre setup, flagged whatever the heading
check('stationary (0 mph) on the coast', crossoverReason({ ...westbound, movementSpeed: 0 }), 'stationary near the coast');
check('drifting W at 4 mph is nearly stationary', crossoverReason({ ...westbound, movementSpeed: 4 }), 'nearly stationary near the coast');
ok('6 mph W is just moving west, not stalled', !isCrossoverWatch({ ...westbound, movementSpeed: 6 }));

// Unknown motion (first advisory) on the coast: flagged
check('unknown motion on the coast is flagged', crossoverReason({ id: 'ep092026', lat: 14, lon: -92, movementDir: null, movementSpeed: null }), 'motion not yet known');

// Acapulco and west of 100W: a landfall there dies over the Sierra Madre
ok('Acapulco (100.1W) moving N is outside the crossover box', !isPacificSide({ id: 'ep092026', lat: 16.5, lon: -100.1, movementDir: 360, movementSpeed: 8 }));
ok('Michoacan coast (102W) moving N is not on watch', !isCrossoverWatch({ id: 'ep092026', lat: 18, lon: -102, movementDir: 360, movementSpeed: 8 }));

// Atlantic storms in the Bay of Campeche stay in region and never on watch
const campeche = { id: 'al142024', lat: 19.5, lon: -94, movementDir: 45, movementSpeed: 6 };
ok('Atlantic Bay of Campeche storm is in region', isInRegionBox(campeche.lat, campeche.lon));
ok('Atlantic Bay of Campeche storm is not Pacific side', !isPacificSide(campeche));
ok('Atlantic Bay of Campeche storm is not on watch', !isCrossoverWatch(campeche));

// A Pacific storm that has crossed and re-emerged in the Gulf keeps its EP id
// — it is north of the crossover box, so it counts as in region like any other
const crossed = { id: 'ep112010', lat: 19.2, lon: -94.5, movementDir: 340, movementSpeed: 8 };
ok('crossed-over EP storm in the Bay of Campeche is not Pacific side', !isPacificSide(crossed));
ok('crossed-over EP storm is in region', isInRegionBox(crossed.lat, crossed.lon));

check('crossover box edges are inclusive', isPacificSide({ id: 'ep01', lat: PACIFIC_CROSSOVER_BOX.maxLat, lon: PACIFIC_CROSSOVER_BOX.minLon }), true);
check('missing position is never Pacific side', isPacificSide({ id: 'ep01', lat: null, lon: null }), false);

/* -- gyre note ----------------------------------------------------------------- */

const gulfArea = { matchedKeywords: ['campeche'] };
const floridaArea = { matchedKeywords: ['florida'] };
ok('Atlantic Gulf area + Pacific watch storm -> gyre note', !!gyreNote({ inAreas: [gulfArea], watchStorms: [elevenE] }));
ok('Atlantic Gulf area + Pacific outlook area -> gyre note', !!gyreNote({ inAreas: [gulfArea], pacificAreas: [{}] }));
check('Florida-only Atlantic area is not a gyre', gyreNote({ inAreas: [floridaArea], watchStorms: [elevenE] }), null);
check('nothing on the Pacific side is not a gyre', gyreNote({ inAreas: [gulfArea] }), null);
check('empty input is fine', gyreNote({}), null);

/* -- outlook motion phrase --------------------------------------------------- */

check('motion: northward', outlookMotion('as it moves slowly northward'), 'northward');
check('motion: west-northwestward', outlookMotion('the low moves slowly west-northwestward'), 'west-northwestward');
check('motion: drifting', outlookMotion('while the system drifts northeastward'), 'northeastward');
check('motion: none', outlookMotion('is expected to remain nearly stationary'), null);

/* -- classification ----------------------------------------------------------- */

check('HU label', classificationInfo('HU').label, 'Hurricane');
check('TS tone is warn', classificationInfo('TS').tone, 'warn');
check('PTC ranks lowest of the known codes', classificationInfo('PTC').rank < classificationInfo('TD').rank, true);
check('unknown code falls back safely', classificationInfo('XX').label, 'XX');
check('unknown code has rank 0 (sorts last)', classificationInfo('XX').rank, 0);

/* -- kt -> mph ------------------------------------------------------------ */

check('90kt hurricane ~ 104mph', ktToMph(90), 104);
check('null intensity stays null', ktToMph(null), null);
check('non-numeric intensity stays null', ktToMph('90'), null);

/* -- formation chance tone -------------------------------------------------- */

check('high formation chance is bad (red)', formationTone('high'), 'bad');
check('medium formation chance is warn (amber)', formationTone('Medium'), 'warn');
check('low formation chance is info', formationTone('low'), 'info');
check('missing category is muted', formationTone(undefined), 'muted');

/* -- outlook parsing, against a real captured NHC response ------------------ */

const fixtureXml = await readFile(join(HERE, '..', 'fixtures', 'outlook-sample.xml'), 'utf8');
const cdata = fixtureXml.match(/<!\[CDATA\[([\s\S]*?)\]\]>/);
ok('fixture has a CDATA description block', !!cdata);

const text = htmlToText(cdata[1]);
ok('htmlToText strips <br /> tags', !text.includes('<br'));

const areas = parseOutlook(text);
check('fixture parses to exactly 2 disturbances', areas.length, 2);

const gulf = areas[0];
check('area 1 name', gulf.area, 'Northern Gulf of America');
check('area 1 motion phrase', gulf.motion, 'west-northwestward');
check('area 1 bin number', gulf.binNumber, 'AL97');
check('area 1 is flagged in-region', gulf.inRegion, true);
check('area 1 48h formation category', gulf.formationChance48h.category, 'medium');
check('area 1 48h formation percent phrase', gulf.formationChance48h.percent, '50 percent');
check('area 1 7d formation category', gulf.formationChance7d.category, 'medium');
ok('area 1 body text does not include the bullet lines', !gulf.text.includes('Formation chance'));
ok('area 1 body text is non-empty prose', gulf.text.length > 50);

const dolly = areas[1];
check('area 2 name', dolly.area, 'Near Puerto Rico and the Virgin Islands');
check('area 2 has no invest bin (remnants, not yet numbered)', dolly.binNumber, null);
check('area 2 descriptor carries the parenthetical', dolly.descriptor, 'Remnants of Dolly');
check('area 2 "near 0 percent" is preserved verbatim, not rounded to 0', dolly.formationChance48h.percent, 'near 0 percent');
ok('area 2 is in-region via "Gulf of America" mention later in the text', dolly.inRegion);

/* -- quiet basin: no headings means no areas, not a crash -------------------- */

const quietText = 'For the North Atlantic...Caribbean Sea and the Gulf of America:\n\n'
  + 'Tropical cyclone formation is not expected during the next 7 days.\n\n$$\nForecaster Beven';
check('quiet basin parses to zero areas', parseOutlook(quietText).length, 0);

/* -- headings without a parenthetical (the common case) ----------------------
 * Captured live 2026-09-15, when the committed data said "0 areas" while NHC
 * was tracking one. Late-season Gulf headings ("Bay of Campeche:", "Southwestern
 * Caribbean Sea:") look exactly like this until an invest number is assigned. */

const plainXml = await readFile(join(HERE, '..', 'fixtures', 'outlook-plain-heading.xml'), 'utf8');
const plainAreas = parseOutlook(htmlToText(plainXml.match(/<!\[CDATA\[([\s\S]*?)\]\]>/)[1]));
check('plain-heading fixture parses to 1 disturbance', plainAreas.length, 1);
check('plain heading area name', plainAreas[0]?.area, 'Central Subtropical Atlantic');
check('plain heading has no descriptor', plainAreas[0]?.descriptor, null);
check('plain heading has no bin', plainAreas[0]?.binNumber, null);
check('plain heading 7d chance', plainAreas[0]?.formationChance7d?.percent, '40 percent');
check('subtropical Atlantic is not in region', plainAreas[0]?.inRegion, false);

// the same disturbance, headed the way NHC heads a Gulf one late in the season
const campecheText = 'For the North Atlantic...Caribbean Sea and the Gulf of America:\n\n'
  + 'Active Systems:\nThe National Hurricane Center is issuing advisories on Hurricane Kirk, located over the central Atlantic.\n\n'
  + 'Bay of Campeche:\nA broad area of low pressure over Central America, partly the remnants of an\n'
  + 'eastern Pacific system, is expected to move northward into the Bay of Campeche.\n'
  + 'Interests in the following areas should monitor its progress:\nthe Gulf coast of Mexico.\n'
  + '* Formation chance through 48 hours...low...20 percent.\n'
  + '* Formation chance through 7 days...high...70 percent.\n\n$$\nForecaster Beven';
const campecheAreas = parseOutlook(campecheText);
check('"Active Systems:" is not a disturbance', campecheAreas.length, 1);
check('Bay of Campeche heading parses', campecheAreas[0]?.area, 'Bay of Campeche');
check('Bay of Campeche is in region', campecheAreas[0]?.inRegion, true);
check('Bay of Campeche keywords', campecheAreas[0]?.matchedKeywords, ['gulf', 'campeche', 'central america', 'eastern pacific']);
check('Bay of Campeche motion', campecheAreas[0]?.motion, 'northward');
check('a mid-paragraph line ending in ":" does not split the area', campecheAreas[0]?.formationChance7d?.category, 'high');
ok('the mid-paragraph line stays in the body text', campecheAreas[0]?.text.includes('should monitor its progress: the Gulf coast'));

/* -- eastern Pacific outlook, against a real captured response -------------- */

const epXml = await readFile(join(HERE, '..', 'fixtures', 'outlook-pacific-sample.xml'), 'utf8');
const epAreas = parseOutlook(htmlToText(epXml.match(/<!\[CDATA\[([\s\S]*?)\]\]>/)[1]), matchPacificKeywords);
check('Pacific fixture parses to 3 disturbances (Active Systems excluded)', epAreas.length, 3);
check('Pacific area names', epAreas.map((a) => a.area), ['Southwest of Southwestern Mexico', 'Gulf of California', 'Western Portion of the Eastern Pacific']);
check('none of them is near Central America', epAreas.filter((a) => a.inRegion).length, 0);
check('Pacific 7d chance parsed', epAreas[0]?.formationChance7d, { category: 'medium', percent: '40 percent' });

const tehuantepecText = 'For the eastern and central North Pacific east of 180 longitude:\n\n'
  + 'Gulf of Tehuantepec:\nA broad area of low pressure could form over the Gulf of Tehuantepec and\n'
  + 'the adjacent coasts of southern Mexico and Guatemala late this week. Some\n'
  + 'development is possible while it drifts northward.\n'
  + '* Formation chance through 48 hours...low...10 percent.\n'
  + '* Formation chance through 7 days...medium...40 percent.\n\n$$\nForecaster Blake';
const teh = parseOutlook(tehuantepecText, matchPacificKeywords)[0];
check('Tehuantepec Pacific area is kept', teh?.inRegion, true);
check('Tehuantepec keywords', teh?.matchedKeywords, ['tehuantepec', 'southern mexico', 'guatemala']);
check('Tehuantepec motion', teh?.motion, 'northward');

/* -- display-only renaming --------------------------------------------- */

check('renames Gulf of America for display', localizeGulf('Northern Gulf of America'), 'Northern Gulf of Mexico');
check('renaming is case-insensitive', localizeGulf('the gulf of america'), 'the Gulf of Mexico');
check('leaves unrelated text alone', localizeGulf('Near Puerto Rico'), 'Near Puerto Rico');
check('non-string input passes through unchanged', localizeGulf(null), null);
ok('parsed area name from the fixture still says "Gulf of America" (source stays verbatim)', gulf.area.includes('Gulf of America'));
check('the same name renders as Gulf of Mexico', localizeGulf(gulf.area), 'Northern Gulf of Mexico');

/* -- summary ------------------------------------------------------------ */

console.log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
