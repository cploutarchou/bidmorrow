/**
 * The public sample-verdict demo's data contract.
 *
 * The values themselves live in `sample-verdicts.generated.ts`, written by
 * `packages/procurement/scripts/generate-sample-verdicts.ts`: real output of
 * the production matching engine scoring real eForms notices against
 * representative supplier profiles. Nothing on the demo page is authored by
 * hand, which is the whole point — a demonstration of explainability that
 * showed invented numbers would be demonstrating the opposite of the
 * product's claim (docs/product-scope.md, "Product policy lock", 2026-08-17).
 *
 * This file holds only the shape and the pure helpers, so the generated file
 * stays pure data and can be overwritten without losing logic.
 */
import type { Classification } from './format';

export interface SampleVerdictComponent {
  /** `match_components.component_key` vocabulary — the same one the customer UI reads. */
  readonly key: string;
  readonly points: number;
  readonly maxPoints: number;
  readonly status: string;
  readonly explanation: string;
}

export interface SampleVerdictRiskFlag {
  readonly type: string;
  readonly confidence: string;
  readonly explanation: string;
  readonly evidence: string | null;
}

/**
 * Where the notice behind a verdict comes from.
 *
 * `ted_notice` — a notice TED actually published: a real buyer, a real
 * procurement, a resolvable ted.europa.eu link.
 *
 * `eforms_example` — one of the Publications Office's own official eForms
 * example notices. A real, well-formed eForms document that the engine
 * scores exactly as it scores a live one, but not a tender anyone could have
 * bid for. The page labels these rather than presenting them as live
 * tenders, because a demo about honesty cannot round them up to one.
 */
export type SampleVerdictSourceKind = 'ted_notice' | 'eforms_example';

/** Which public pages show a verdict — see `SampleCase.surfaces` in the generator. */
export type SampleVerdictSurface = 'demo' | 'cybersecurity';

export interface SampleVerdict {
  readonly id: string;
  /** One line on why this pairing is worth showing — editorial, not engine output. */
  readonly why: string;
  readonly surfaces: readonly SampleVerdictSurface[];
  readonly supplierLabel: string;
  readonly tenderTitle: string;
  readonly buyerName: string | null;
  /** ISO alpha-2, derived from the buyer exactly as the scored input derives it. */
  readonly country: string | null;
  readonly cpvMain: string;
  readonly valueEur: number | null;
  readonly deadlineAt: number | null;
  readonly sourceNoticeId: string | null;
  readonly sourceKind: SampleVerdictSourceKind;
  readonly sourceUrl: string | null;
  /** `YYYY-MM-DD`, only for notices TED published. */
  readonly publicationDate: string | null;
  /** `null` for an excluded lot: the engine stops at the rule and never scores it. */
  readonly score: number | null;
  readonly classification: Classification;
  readonly exclusionRule: string | null;
  readonly exclusionEvidence: string | null;
  /** Empty for an excluded lot — there is no breakdown of a score that was never computed. */
  readonly components: readonly SampleVerdictComponent[];
  readonly riskFlags: readonly SampleVerdictRiskFlag[];
  readonly explanation: string;
}

/**
 * The one-line recommendation shown under each verdict.
 *
 * Phrased as what a bid team should DO, which is the decision the product
 * supports, and never as a guarantee of eligibility or award
 * (docs/product-scope.md "Product-truth rules"). Excluded states that the
 * lot never reached scoring, because showing it as "0" would be a different
 * and false claim.
 */
export function sampleRecommendation(verdict: SampleVerdict): string {
  switch (verdict.classification) {
    case 'STRONG_MATCH':
      return 'Pursue — read the tender documents and start a bid/no-bid review.';
    case 'WORTH_REVIEWING':
      return 'Review — enough of this fits that a person should look before deciding.';
    case 'POSSIBLE_MATCH':
      return 'Skim — adjacent to what this supplier does, not central to it.';
    case 'LOW_FIT':
      return 'Skip — little here matches what this supplier sells.';
    case 'EXCLUDED':
      return 'Skip — ruled out by this supplier’s own settings, before any scoring.';
  }
}

/**
 * Human label for an exclusion rule (`ExclusionRule` in
 * packages/matching/src/types.ts). Falls back to the raw rule so a new engine
 * rule shows up as itself rather than vanishing from the page.
 */
const EXCLUSION_RULE_LABEL: Record<string, string> = {
  excluded_geography: 'A place this supplier does not work in',
  excluded_cpv: 'A CPV family this supplier ruled out',
  excluded_phrase: 'A phrase this supplier ruled out',
  unsupported_nature: 'A contract type this supplier does not bid',
  deadline_below_threshold: 'Less notice than this supplier needs to bid',
};

export function exclusionRuleLabel(rule: string): string {
  return EXCLUSION_RULE_LABEL[rule] ?? rule;
}
