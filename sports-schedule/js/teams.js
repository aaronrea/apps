/* ---------------------------------------------------------------------------
 * Slate — the teams being followed
 *
 * `espnId` is ESPN's team id inside `path`. Verified live on 2026-08-09 by
 * calling each schedule endpoint and reading back the team name:
 *
 *   football/college-football/teams/245  → Texas A&M Aggies
 *   football/nfl/teams/27                → Tampa Bay Buccaneers
 *   hockey/nhl/teams/20                  → Tampa Bay Lightning
 *
 * To follow another team, add a row: `path` is the sport/league segment pair,
 * `espnId` the numeric id. Nothing else in the app is team-aware.
 * ------------------------------------------------------------------------- */

/* Accents are the real team colours lightened enough to hold their own on a
 * near-black card edge — Lightning navy and Aggie maroon are both invisible at
 * their true values here. They tint the card border only; the logos in the
 * cards are the untouched full-colour marks. */
export const TEAMS = [
  {
    id: 'aggies',
    name: 'Texas A&M',
    label: 'Aggies',
    league: 'NCAAF',
    path: 'football/college-football',
    espnId: '245',
    accent: '#c8506a'
  },
  {
    id: 'bucs',
    name: 'Buccaneers',
    label: 'Bucs',
    league: 'NFL',
    path: 'football/nfl',
    espnId: '27',
    accent: '#ff6b52'
  },
  {
    id: 'bolts',
    name: 'Lightning',
    label: 'Bolts',
    league: 'NHL',
    path: 'hockey/nhl',
    espnId: '20',
    accent: '#4da3ff'
  }
];

/* ESPN splits a schedule by season type and returns nothing at all for the
 * ones that have not been drawn up yet, so all three are always requested and
 * the empty ones cost a few hundred bytes. Omitting `season` lets ESPN resolve
 * the current year itself, which matters because the NHL's 2026-27 season is
 * year 2027 while the NFL's 2026 season is year 2026. */
export const SEASON_TYPES = [1, 2, 3];

/* How far ahead the bottom section looks. */
export const HORIZON_DAYS = 7;
