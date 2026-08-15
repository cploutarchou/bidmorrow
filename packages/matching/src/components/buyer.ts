/**
 * Buyer/sector (5 pts). docs/matching-engine.md §Buyer/sector.
 *
 * V1 heuristic on the eForms `buyer-legal-type` codelist (SDK 1.15.1
 * `buyer-legal-type.json`, verified per docs/dependency-versions.md).
 * Strong-fit codes (5 pts) target authorities that regularly procure
 * IT/consulting services: central government, regional/local authority, and
 * bodies governed by public law. `eu-ins-bod-ag` (EU institution/agency) is
 * included as strong-fit — these are large, IT-services-heavy buyers.
 * Everything else recognized (`listName='buyer-legal-type'` codes not in the
 * strong-fit set, e.g. public undertaking, private-law body) scores neutral
 * (3 pts): plausible but not a demonstrated strong fit. Unrecognized/absent
 * codes are UNKNOWN.
 */
import { COMPONENT_MAX, UNKNOWN_NEUTRAL } from '../index';
import type { ComponentResult } from '../types';

/** eForms buyer-legal-type codes with a demonstrated strong fit for IT/consulting suppliers. */
const STRONG_FIT_CODES = new Set([
  'cga', // central government authority
  'la', // local authority
  'ra', // regional authority
  'body-pl', // body governed by public law
  'eu-ins-bod-ag', // EU institution, body or agency
]);

/** Any other code recognized by the codelist is a known-but-neutral buyer type. */
const KNOWN_CODES = new Set([
  ...STRONG_FIT_CODES,
  'pub-undert', // public undertaking
  'org-sub', // organization awarding a contract subsidized by a contracting authority
  'eu-int-org', // European institution/international organization (non-EU)
  'grp-p-aut', // group of public authorities
  'not-pub-fond', // not publicly funded body
]);

const STRONG_FIT_LABEL: Record<string, string> = {
  cga: 'central government authority',
  la: 'local authority',
  ra: 'regional authority',
  'body-pl': 'body governed by public law',
  'eu-ins-bod-ag': 'EU institution, body or agency',
};

export function scoreBuyer(buyerLegalType: string | null): ComponentResult {
  const maxPoints = COMPONENT_MAX.buyer;

  if (buyerLegalType === null) {
    return {
      key: 'buyer',
      points: maxPoints * UNKNOWN_NEUTRAL,
      maxPoints,
      status: 'UNKNOWN',
      explanation: 'Buyer: buyer legal type not published — neutral score applied.',
    };
  }

  if (STRONG_FIT_CODES.has(buyerLegalType)) {
    const label = STRONG_FIT_LABEL[buyerLegalType] ?? buyerLegalType;
    return {
      key: 'buyer',
      points: 5,
      maxPoints,
      status: 'MATCHED',
      explanation: `Buyer: ${label} (strong-fit buyer type)`,
    };
  }

  if (KNOWN_CODES.has(buyerLegalType)) {
    return {
      key: 'buyer',
      points: 3,
      maxPoints,
      status: 'PARTIAL',
      explanation: `Buyer: ${buyerLegalType} (recognized buyer type, neutral fit)`,
    };
  }

  return {
    key: 'buyer',
    points: maxPoints * UNKNOWN_NEUTRAL,
    maxPoints,
    status: 'UNKNOWN',
    explanation: `Buyer: unrecognized buyer legal type code "${buyerLegalType}" — neutral score applied.`,
  };
}
