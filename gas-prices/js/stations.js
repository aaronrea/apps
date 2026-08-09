/* ---------------------------------------------------------------------------
 * Pump — the four stations, in the order they matter.
 *
 * This list is deliberately fixed and short. The whole point of the app is
 * that it is *already* zoomed in: no map to pan, no radius to widen, no
 * results to sort. These four, ranked, with the comparison already done.
 *
 * Roles drive the logic but are deliberately NOT shown. `preferred` and
 * `benchmark` still decide the verdict and the yardstick; they just aren't
 * labelled on screen, because a "preferred" label describes a routine and a
 * store number describes a neighbourhood. The list renders as four brands and
 * four prices, sorted cheapest first.
 *
 *   preferred — the default answer. Wins ties and gets the go / no-go verdict.
 *   benchmark — the price everything else is measured against.
 *   other     — reference only. Flagged red past the threshold.
 *
 * `url` is what the fetcher scrapes, so it necessarily pins the exact store.
 * It is not linked from the UI, but it is right here in a public repo — see
 * the anonymity note in README.md before treating this as private.
 * ------------------------------------------------------------------------- */

export const STATIONS = [
  {
    id: 'wawa',
    name: 'Wawa',
    icon: '🦆',
    role: 'preferred',
    url: 'https://www.wawa.com/locations/5185'
  },
  {
    id: 'costco',
    name: 'Costco',
    icon: '📦',
    role: 'benchmark',
    url: 'https://www.costco.com/w/-/fl/bradenton/1364'
  },
  {
    id: 'racetrac',
    name: 'RaceTrac',
    icon: '🏁',
    role: 'other',
    url: 'https://www.racetrac.com/locations/florida/bradenton/lena'
  },
  {
    id: '7-eleven',
    name: '7-Eleven',
    icon: '🏪',
    role: 'other',
    url: 'https://www.7-eleven.com/locations/fl/bradenton/11805-sr-70-east-38565'
  }
];

/* Everything here is regular unleaded. Stated once, in one place, so the UI
 * can label it without every station carrying a redundant grade field. */
export const GRADE = 'Regular unleaded';

/* Red past this much more expensive than the benchmark. */
export const THRESHOLD_PCT = 5;

export function stationById(id) {
  return STATIONS.find((s) => s.id === id) || null;
}
