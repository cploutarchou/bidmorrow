/**
 * Static EU/EEA land-border adjacency table, ISO-3166-1 alpha-2 codes.
 *
 * Used only for the geography component's "neighboring country" tier (6
 * pts) — deliberately conservative and hand-curated, not derived from any
 * live API (determinism requirement: docs/matching-engine.md invariant 1).
 * Covers the 27 EU member states plus the EEA/EFTA and UK/Balkan
 * neighbors most likely to matter for procurement geography. Source: general
 * geography (land borders as commonly enumerated, e.g. CIA World
 * Factbook country pages / Eurostat NUTS territory lists) — not
 * exhaustive of every micro-state border (e.g. Vatican/San Marino/Monaco/
 * Andorra are included as land-locked enclaves of their host state since
 * they can legitimately appear as buyer/lot countries).
 */

/** One direction per line; `buildAdjacency` symmetrizes the table. */
const EDGES: readonly (readonly [string, string])[] = [
  ['AT', 'DE'],
  ['AT', 'CZ'],
  ['AT', 'SK'],
  ['AT', 'HU'],
  ['AT', 'SI'],
  ['AT', 'IT'],
  ['AT', 'CH'],
  ['AT', 'LI'],
  ['BE', 'FR'],
  ['BE', 'LU'],
  ['BE', 'NL'],
  ['BE', 'DE'],
  ['BG', 'RO'],
  ['BG', 'GR'],
  ['BG', 'MK'],
  ['BG', 'RS'],
  ['BG', 'TR'],
  ['HR', 'SI'],
  ['HR', 'HU'],
  ['HR', 'RS'],
  ['HR', 'BA'],
  ['HR', 'ME'],
  ['CZ', 'DE'],
  ['CZ', 'PL'],
  ['CZ', 'SK'],
  ['DK', 'DE'],
  ['EE', 'LV'],
  ['EE', 'RU'],
  ['FI', 'SE'],
  ['FI', 'NO'],
  ['FI', 'RU'],
  ['FR', 'DE'],
  ['FR', 'LU'],
  ['FR', 'CH'],
  ['FR', 'IT'],
  ['FR', 'ES'],
  ['FR', 'AD'],
  ['FR', 'MC'],
  ['DE', 'PL'],
  ['DE', 'CH'],
  ['DE', 'NL'],
  ['GR', 'AL'],
  ['GR', 'MK'],
  ['GR', 'TR'],
  ['HU', 'SK'],
  ['HU', 'UA'],
  ['HU', 'RO'],
  ['HU', 'RS'],
  ['IE', 'UK'],
  ['IT', 'CH'],
  ['IT', 'SI'],
  ['IT', 'VA'],
  ['IT', 'SM'],
  ['LV', 'LT'],
  ['LV', 'RU'],
  ['LV', 'BY'],
  ['LT', 'PL'],
  ['LT', 'BY'],
  ['LT', 'RU'],
  ['LU', 'DE'],
  ['PL', 'SK'],
  ['PL', 'UA'],
  ['PL', 'BY'],
  ['PL', 'RU'],
  ['PT', 'ES'],
  ['RO', 'RS'],
  ['RO', 'UA'],
  ['RO', 'MD'],
  ['SK', 'UA'],
  ['SI', 'HU'],
  ['ES', 'AD'],
  ['SE', 'NO'],
  ['NO', 'RU'],
  ['LI', 'CH'],
];

function buildAdjacency(): ReadonlyMap<string, ReadonlySet<string>> {
  const map = new Map<string, Set<string>>();
  const add = (a: string, b: string): void => {
    const set = map.get(a) ?? new Set<string>();
    set.add(b);
    map.set(a, set);
  };
  for (const [a, b] of EDGES) {
    add(a, b);
    add(b, a);
  }
  return map;
}

const ADJACENCY = buildAdjacency();

/** Neighboring countries (land border) of `country`, per the static table. */
export function neighborsOf(country: string): ReadonlySet<string> {
  return ADJACENCY.get(country.toUpperCase()) ?? new Set();
}

export function areNeighbors(a: string, b: string): boolean {
  return neighborsOf(a).has(b.toUpperCase());
}
