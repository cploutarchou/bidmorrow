/**
 * Geography (15 pts). docs/matching-engine.md §Geography.
 */
import { COMPONENT_MAX, UNKNOWN_NEUTRAL } from '../index';
import { neighborsOf } from '../eu-adjacency';
import type { ComponentResult, LotInput, OrgProfile } from '../types';

export function scoreGeography(lot: LotInput, org: OrgProfile): ComponentResult {
  const maxPoints = COMPONENT_MAX.geography;

  if (lot.nuts.length === 0 && lot.countries.length === 0) {
    return {
      key: 'geography',
      points: maxPoints * UNKNOWN_NEUTRAL,
      maxPoints,
      status: 'UNKNOWN',
      explanation: 'No NUTS region or country on this lot — neutral score applied.',
    };
  }

  const preferredNuts = org.geographies.preferredNuts;
  const matchedNuts = lot.nuts.find((code) =>
    preferredNuts.some((prefix) => code.toUpperCase().startsWith(prefix.toUpperCase())),
  );
  if (matchedNuts !== undefined) {
    const prefix = preferredNuts.find((p) => matchedNuts.toUpperCase().startsWith(p.toUpperCase()));
    return {
      key: 'geography',
      points: 15,
      maxPoints,
      status: 'MATCHED',
      explanation: `Geography: lot NUTS ${matchedNuts} within your preferred region ${String(prefix)}`,
    };
  }

  const opportunityMatch = lot.countries.find((c) =>
    org.geographies.opportunityCountries.includes(c.toUpperCase()),
  );
  if (opportunityMatch !== undefined) {
    return {
      key: 'geography',
      points: 13,
      maxPoints,
      status: 'MATCHED',
      explanation: `Geography: lot country ${opportunityMatch} is one of your preferred opportunity countries`,
    };
  }

  const servedMatch = lot.countries.find((c) =>
    org.geographies.countriesServed.includes(c.toUpperCase()),
  );
  if (servedMatch !== undefined) {
    return {
      key: 'geography',
      points: 10,
      maxPoints,
      status: 'MATCHED',
      explanation: `Geography: lot country ${servedMatch} is one of your countries served`,
    };
  }

  const preferredCountries = [
    ...org.geographies.opportunityCountries,
    ...org.geographies.countriesServed,
  ];
  for (const lotCountry of lot.countries) {
    for (const preferred of preferredCountries) {
      if (neighborsOf(preferred).has(lotCountry.toUpperCase())) {
        return {
          key: 'geography',
          points: 6,
          maxPoints,
          status: 'PARTIAL',
          explanation: `Geography: lot country ${lotCountry} neighbors your preferred country ${preferred}`,
        };
      }
    }
  }

  return {
    key: 'geography',
    points: 0,
    maxPoints,
    status: 'NO_MATCH',
    explanation:
      'Geography: lot location is not within, or neighboring, any of your preferred geographies.',
  };
}
