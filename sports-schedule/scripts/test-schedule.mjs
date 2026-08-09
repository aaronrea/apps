/* ---------------------------------------------------------------------------
 * Slate — tests
 *
 *   node sports-schedule/scripts/test-schedule.mjs
 *
 * No framework and no dependencies, same as the gas app. Covers the two things
 * that are actually easy to get wrong and impossible to eyeball: which day a
 * game lands on once a time zone is involved, and reading a game out of ESPN's
 * payload shape.
 * ------------------------------------------------------------------------- */

import {
  dayKey, shiftKey, formatTime, formatDay, dayLabel, fmtAge,
  bucket, statusLine, scoreLine
} from '../js/schedule.js';
import { normalize } from '../js/espn.js';

let passed = 0;
const failures = [];

function check(name, actual, expected) {
  const a = JSON.stringify(actual);
  const e = JSON.stringify(expected);
  if (a === e) passed++;
  else failures.push(`${name}\n    expected ${e}\n    actual   ${a}`);
}

function ok(name, condition) {
  check(name, Boolean(condition), true);
}

const ET = 'America/New_York';
const PT = 'America/Los_Angeles';

/* -- day keys -------------------------------------------------------------- */

/* A 7pm Eastern puck drop is the same evening in New York and still the
 * afternoon in Los Angeles. Both are "today"; neither is tomorrow. */
check('dayKey — evening ET game, viewed from ET',
  dayKey(new Date('2026-10-01T23:00Z'), ET), '2026-10-01');
check('dayKey — same game, viewed from PT',
  dayKey(new Date('2026-10-01T23:00Z'), PT), '2026-10-01');

/* The case that motivates keys existing at all: after midnight UTC the raw
 * timestamp says the 2nd, but nobody on the US east coast has gone to bed. */
check('dayKey — 10pm ET is still the 1st, not the 2nd UTC',
  dayKey(new Date('2026-10-02T02:00Z'), ET), '2026-10-01');

check('shiftKey — forward across a month end', shiftKey('2026-08-31', 1), '2026-09-01');
check('shiftKey — backward', shiftKey('2026-09-01', -1), '2026-08-31');
/* Adding a day over the US DST change must not come back as the same date. */
check('shiftKey — across the autumn DST seam', shiftKey('2026-11-01', 1), '2026-11-02');
check('shiftKey — a full week', shiftKey('2026-08-09', 7), '2026-08-16');

/* -- formatting ------------------------------------------------------------ */

check('formatTime — states the zone', formatTime('2026-08-14T23:00Z', ET), '7:00 PM EDT');
check('formatTime — same instant, other coast', formatTime('2026-08-14T23:00Z', PT), '4:00 PM PDT');
/* Winter, so the abbreviation has to change with it rather than be hardcoded. */
check('formatTime — standard time', formatTime('2027-01-10T18:00Z', ET), '1:00 PM EST');
check('formatTime — unannounced kickoff', formatTime('2026-09-05T04:00Z', ET, false), 'Time TBD');

check('formatDay', formatDay('2026-08-14'), 'Fri, Aug 14');
check('dayLabel — today', dayLabel('2026-08-09', '2026-08-09'), 'Today');
check('dayLabel — tomorrow', dayLabel('2026-08-10', '2026-08-09'), 'Tomorrow');
check('dayLabel — later in the week', dayLabel('2026-08-14', '2026-08-09'), 'Fri, Aug 14');

const noon = new Date('2026-08-09T12:00:00Z');
check('fmtAge — seconds', fmtAge('2026-08-09T11:59:40Z', noon), 'just now');
check('fmtAge — minutes', fmtAge('2026-08-09T11:54:00Z', noon), '6m ago');
check('fmtAge — hours', fmtAge('2026-08-09T09:00:00Z', noon), '3h ago');
check('fmtAge — days', fmtAge('2026-08-07T12:00:00Z', noon), '2d ago');

/* -- bucketing ------------------------------------------------------------- */

const game = (id, start) => ({ id, start });

const games = [
  game('past', '2026-08-08T23:00Z'),        // yesterday
  game('today-late', '2026-08-10T00:30Z'),  // 8:30pm ET on the 9th
  game('today-early', '2026-08-09T17:00Z'), // 1pm ET on the 9th
  game('in-week', '2026-08-14T23:00Z'),     // Friday
  game('edge-in', '2026-08-16T23:00Z'),     // day 7 exactly
  game('beyond', '2026-08-20T23:00Z')       // outside the horizon
];

const now = new Date('2026-08-09T15:00:00Z'); // 11am ET, Sunday
const view = bucket(games, now, { timeZone: ET, days: 7 });

check('bucket — today is the viewer\'s calendar day', view.todayKey, '2026-08-09');
/* Both of today's games, earliest first, including the one whose UTC date is
 * already tomorrow. */
check('bucket — today, in order', view.today.map((g) => g.id), ['today-early', 'today-late']);
ok('bucket — yesterday is dropped', !JSON.stringify(view).includes('"past"'));

const withGames = view.upcoming.filter((d) => d.games.length);
check('bucket — upcoming days carrying games',
  withGames.map((d) => [d.key, d.games.map((g) => g.id)]),
  [['2026-08-14', ['in-week']], ['2026-08-16', ['edge-in']]]);
check('bucket — always returns one entry per day in the horizon', view.upcoming.length, 7);

check('bucket — the next game beyond the horizon is still named',
  view.next && [view.next.key, view.next.game.id], ['2026-08-20', 'beyond']);

/* Day 8 is outside a 7-day horizon — the boundary that decides whether the
 * bottom section quietly shows eight days. */
const tight = bucket([game('day8', '2026-08-17T23:00Z')], now, { timeZone: ET, days: 7 });
check('bucket — day 8 falls outside the horizon',
  tight.upcoming.every((d) => d.games.length === 0), true);
check('bucket — and becomes the next game', tight.next.game.id, 'day8');

/* Viewed from the west coast the 8:30pm ET game is 5:30pm the same day, so it
 * must not migrate between sections with the viewer. */
const west = bucket(games, now, { timeZone: PT, days: 7 });
check('bucket — today from the west coast', west.today.map((g) => g.id), ['today-early', 'today-late']);

/* Empty is a real state for most of the summer and must not throw. */
const empty = bucket([], now, { timeZone: ET, days: 7 });
check('bucket — no games at all', [empty.today.length, empty.next], [0, null]);

/* -- status and score ------------------------------------------------------ */

check('statusLine — scheduled shows the time',
  statusLine({ state: 'pre', start: '2026-08-14T23:00Z', timeValid: true }, ET),
  { tone: 'pre', text: '7:00 PM EDT' });
check('statusLine — live shows the clock',
  statusLine({ state: 'in', detail: '2nd 8:12' }, ET), { tone: 'live', text: '2nd 8:12' });
check('statusLine — final',
  statusLine({ state: 'post', detail: 'Final/OT' }, ET), { tone: 'final', text: 'Final/OT' });

check('scoreLine — no score yet', scoreLine({ state: 'pre', score: null }), null);
check('scoreLine — a win', scoreLine({ state: 'post', score: { team: 5, opponent: 4 } }),
  { result: 'W', text: '5–4' });
check('scoreLine — a loss', scoreLine({ state: 'post', score: { team: 4, opponent: 5 } }),
  { result: 'L', text: '4–5' });
check('scoreLine — a tie', scoreLine({ state: 'post', score: { team: 17, opponent: 17 } }),
  { result: 'T', text: '17–17' });
/* Mid-game there is a score but no result — calling a 14-0 second quarter a
 * win is exactly the kind of lie this app should not tell. */
check('scoreLine — in progress has no result',
  scoreLine({ state: 'in', score: { team: 14, opponent: 0 } }), { result: null, text: '14–0' });
/* 0-0 is a score, not a missing one. */
check('scoreLine — nil all', scoreLine({ state: 'in', score: { team: 0, opponent: 0 } }),
  { result: null, text: '0–0' });

/* -- normalising ESPN ------------------------------------------------------ */

/* Trimmed to the fields the normaliser reads, in the shape the live API
 * returned them on 2026-08-09. */
const team = { id: 'bolts', name: 'Lightning', league: 'NHL', espnId: '20', accent: '#4da3ff' };

const payload = {
  events: [{
    id: '401891819',
    date: '2026-10-01T23:00Z',
    timeValid: true,
    links: [
      { rel: ['summary', 'sportscenter', 'app', 'event'], href: 'sportscenter://x' },
      { rel: ['summary', 'desktop', 'event'], href: 'https://www.espn.com/nhl/game/1' }
    ],
    competitions: [{
      date: '2026-10-01T23:00Z',
      neutralSite: false,
      venue: { fullName: 'Madison Square Garden', address: { city: 'New York', state: 'NY' } },
      status: { type: { state: 'pre', shortDetail: '10/1 - 7:00 PM EDT' } },
      broadcasts: [
        { type: { shortName: 'TV' }, market: { type: 'Home' }, media: { shortName: 'FDSNSUN' } },
        { type: { shortName: 'Streaming' }, market: { type: 'National' }, media: { shortName: 'ESPN+' } },
        { type: { shortName: 'TV' }, market: { type: 'Home' }, media: { shortName: 'FDSNSUN' } }
      ],
      competitors: [
        {
          homeAway: 'home', score: { value: 0 },
          team: { id: '3', abbreviation: 'NYR', shortDisplayName: 'Rangers',
            logos: [
              { rel: ['full', 'dark'], href: 'https://a.espncdn.com/i/teamlogos/nhl/500-dark/nyr.png' },
              { rel: ['full', 'default'], href: 'https://a.espncdn.com/i/teamlogos/nhl/500/nyr.png' }
            ] }
        },
        {
          homeAway: 'away', score: { value: 0 },
          team: { id: '20', abbreviation: 'TB', shortDisplayName: 'Lightning',
            logos: [{ rel: ['full', 'default'], href: 'https://a.espncdn.com/i/teamlogos/nhl/500/tb.png' }] }
        }
      ]
    }]
  }]
};

const [normalised] = normalize(payload, team);

check('normalize — identity', [normalised.id, normalised.league, normalised.teamId],
  ['401891819', 'NHL', 'bolts']);
/* The followed team is picked out by id, not by position in the array. */
check('normalize — the followed team is "team"', normalised.team.name, 'Lightning');
check('normalize — the other side is "opponent"', normalised.opponent.name, 'Rangers');
check('normalize — away game', normalised.home, false);
/* The colour mark, not the white silhouette — and requested at chip size,
 * because ESPN's "500" directory will happily hand back a 4096px file. */
check('normalize — full-colour logo, not the white silhouette, resized',
  [normalised.team.logo, normalised.opponent.logo],
  ['https://a.espncdn.com/combiner/i?img=/i/teamlogos/nhl/500/tb.png&w=68&h=68',
    'https://a.espncdn.com/combiner/i?img=/i/teamlogos/nhl/500/nyr.png&w=68&h=68']);

/* Anything not on the CDN's own image path is passed through rather than
 * rewritten into a URL the combiner would reject. */
const oddLogo = JSON.parse(JSON.stringify(payload));
oddLogo.events[0].competitions[0].competitors[1].team.logos =
  [{ rel: ['full', 'default'], href: 'https://example.com/logo.png' }];
check('normalize — off-CDN logo passed through',
  normalize(oddLogo, team)[0].team.logo, 'https://example.com/logo.png');

const noLogo = JSON.parse(JSON.stringify(payload));
delete noLogo.events[0].competitions[0].competitors[0].team.logos;
check('normalize — missing logo is null, not a broken URL',
  normalize(noLogo, team)[0].opponent.logo, null);
check('normalize — venue', normalised.venue, { name: 'Madison Square Garden', where: 'New York, NY' });
check('normalize — channels, deduped, streaming after TV',
  normalised.broadcasts,
  [{ name: 'FDSNSUN', kind: 'tv', market: 'Home' },
    { name: 'ESPN+', kind: 'streaming', market: 'National' }]);
check('normalize — web link, not the app deep link',
  normalised.link, 'https://www.espn.com/nhl/game/1');
check('normalize — 0-0 before puck drop is still read as a score',
  normalised.score, { team: 0, opponent: 0 });

/* A bare string score appears on some responses; both forms have to work. */
const stringScores = JSON.parse(JSON.stringify(payload));
stringScores.events[0].competitions[0].competitors[0].score = '4';
stringScores.events[0].competitions[0].competitors[1].score = '5';
check('normalize — string scores', normalize(stringScores, team)[0].score, { team: 5, opponent: 4 });

/* The API is undocumented and can change shape without warning, so anything
 * unreadable has to drop out rather than render as half a card. */
check('normalize — no events', normalize({}, team), []);
check('normalize — null payload', normalize(null, team), []);
check('normalize — event with no competition',
  normalize({ events: [{ id: '1' }] }, team), []);
check('normalize — a game the followed team is not in',
  normalize({
    events: [{
      id: '2', date: '2026-10-01T23:00Z',
      competitions: [{ date: '2026-10-01T23:00Z', status: { type: {} },
        competitors: [{ homeAway: 'home', team: { id: '3' } }, { homeAway: 'away', team: { id: '4' } }] }]
    }]
  }, team), []);
check('normalize — only one side listed',
  normalize({
    events: [{
      id: '3', date: '2026-10-01T23:00Z',
      competitions: [{ date: '2026-10-01T23:00Z', status: { type: {} },
        competitors: [{ homeAway: 'home', team: { id: '20' } }] }]
    }]
  }, team), []);

const tbd = JSON.parse(JSON.stringify(payload));
tbd.events[0].timeValid = false;
check('normalize — carries the TBD flag through', normalize(tbd, team)[0].timeValid, false);

/* -- report ---------------------------------------------------------------- */

if (failures.length) {
  console.error(`\n${failures.length} failed, ${passed} passed\n`);
  for (const failure of failures) console.error(`  ✗ ${failure}\n`);
  process.exit(1);
}

console.log(`${passed} passed`);
