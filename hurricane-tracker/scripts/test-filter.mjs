#!/usr/bin/env node
/* ---------------------------------------------------------------------------
 * Cone — tests for the region filter and outlook parser
 *
 * No framework, no dependencies: node scripts/test-filter.mjs
 *
 * The fixture in fixtures/outlook-sample.xml is a real Atlantic outlook RSS
 * response, captured live on 2026-08-30 (a Gulf invest near the Louisiana/
 * Texas coast, plus the remnants of Dolly near Puerto Rico) — not a made-up
 * shape.
 * ------------------------------------------------------------------------- */

import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import {
  isInRegionBox, matchRegionKeywords, textMentionsRegion,
  classificationInfo, ktToMph, formationTone, REGION_BOX
} from '../js/filter.js';
import { htmlToText, parseOutlook } from '../js/outlook.js';
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
