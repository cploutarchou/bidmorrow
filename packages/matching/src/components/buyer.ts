/**
 * Buyer/sector (5 pts). docs/matching-engine.md §Buyer/sector.
 *
 * Heuristic over the eForms `buyer-legal-type` codelist. The code sets below
 * are the COMPLETE list from OP-TED eForms-SDK 1.13.2
 * (`codelists/buyer-legal-type.gc`), read from the SDK itself on 2026-08-23
 * and recorded in docs/dependency-versions.md — not from memory, and not
 * from the earlier partial set.
 *
 * Strong-fit codes (5 pts) are the authorities that regularly procure
 * IT/consulting services: central government, regional and local authority,
 * bodies governed by public law (including the three sub-types that name
 * which authority controls them), and `eu-ins-bod-ag`, which are large and
 * IT-services-heavy. Every other code in the codelist scores neutral (3 pts):
 * plausible, but not a demonstrated strong fit. Only a code outside the
 * codelist, or an absent one, is UNKNOWN.
 *
 * WHY THE SETS WERE WRONG (fixed 2026-08-23, ENGINE_VERSION 1 → 2). The
 * previous sets held 12 codes where the codelist has 20, and two of the 12
 * (`eu-int-org`, `not-pub-fond`) are not in the codelist at all. The eight
 * missing ones are all sub-types that name a controlling authority
 * — `body-pl-cga` / `-la` / `-ra`, `pub-undert-cga` / `-la` / `-ra`,
 * `org-sub-cga` / `-la` / `-ra` — plus `def-cont`, `int-org` and
 * `spec-rights-entity`. Real notices use them heavily: 7 of the 25 TED
 * fixtures in this repo carry one, and every one of those was being scored
 * UNKNOWN. Four are universities and hospitals under `body-pl-cga` /
 * `body-pl-ra` — squarely the strong-fit case — which lost 2.5 of 5 points
 * apiece for no reason other than an incomplete list.
 */
import { COMPONENT_MAX, UNKNOWN_NEUTRAL } from '../index';
import type { ComponentResult } from '../types';

/**
 * Codes with a demonstrated strong fit for IT/consulting suppliers.
 *
 * The `body-pl-*` sub-types are here for the same reason `body-pl` is: they
 * ARE bodies governed by public law, and the suffix only records which
 * authority controls them. Treating the parent as strong-fit and the
 * sub-types as unknown was the defect, not a judgement.
 */
const STRONG_FIT_CODES = new Set([
  'cga', // central government authority
  'la', // local authority
  'ra', // regional authority
  'body-pl', // body governed by public law
  'body-pl-cga', // …controlled by a central government authority
  'body-pl-la', // …controlled by a local authority
  'body-pl-ra', // …controlled by a regional authority
  'eu-ins-bod-ag', // EU institution, body or agency
]);

/** The rest of the codelist: recognized, but not a demonstrated strong fit. */
const KNOWN_CODES = new Set([
  ...STRONG_FIT_CODES,
  'pub-undert', // public undertaking
  'pub-undert-cga', // …controlled by a central government authority
  'pub-undert-la', // …controlled by a local authority
  'pub-undert-ra', // …controlled by a regional authority
  'org-sub', // organisation awarding a contract subsidised by a contracting authority
  'org-sub-cga', // …subsidised by a central government authority
  'org-sub-la', // …subsidised by a local authority
  'org-sub-ra', // …subsidised by a regional authority
  'grp-p-aut', // group of public authorities
  'int-org', // international organisation
  'def-cont', // defence contractor
  'spec-rights-entity', // entity with special or exclusive rights
]);

const STRONG_FIT_LABEL: Record<string, string> = {
  cga: 'central government authority',
  la: 'local authority',
  ra: 'regional authority',
  'body-pl': 'body governed by public law',
  'body-pl-cga': 'body governed by public law, under a central government authority',
  'body-pl-la': 'body governed by public law, under a local authority',
  'body-pl-ra': 'body governed by public law, under a regional authority',
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
