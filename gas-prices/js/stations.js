/* ---------------------------------------------------------------------------
 * Pump — the four stations, in the order they matter.
 *
 * This list is deliberately fixed and short. The whole point of the app is
 * that it is *already* zoomed in: no map to pan, no radius to widen, no
 * results to sort. These four, ranked, with the comparison already done.
 *
 * Roles drive both layout and logic:
 *   preferred — the default answer. On the daily loop, so it wins ties and
 *               gets the go / no-go verdict.
 *   benchmark — the price everything else is measured against.
 *   other     — reference only. Flagged red past the threshold.
 *
 * `where` is intentionally only ever what the station's own URL already
 * tells us (store number, cross street, street address). Full addresses are
 * left to the fetcher to fill in if a source happens to publish one — better
 * a short label than a confidently wrong address.
 * ------------------------------------------------------------------------- */

export const STATIONS = [
  {
    id: 'wawa',
    name: 'Wawa',
    where: 'Store #5185',
    role: 'preferred',
    note: 'On the daily loop',
    url: 'https://www.wawa.com/locations/5185'
  },
  {
    id: 'costco',
    name: 'Costco',
    where: 'Bradenton #1364',
    role: 'benchmark',
    note: 'Membership required',
    url: 'https://www.costco.com/w/-/fl/bradenton/1364'
  },
  {
    id: 'racetrac',
    name: 'RaceTrac',
    where: 'Lena Rd',
    role: 'other',
    url: 'https://www.racetrac.com/locations/florida/bradenton/lena'
  },
  {
    id: '7-eleven',
    name: '7-Eleven',
    where: '11805 SR 70 E',
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
