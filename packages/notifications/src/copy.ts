/**
 * Copy constants shared by every email this package renders. Deliberately
 * NOT imported from `apps/web/src/copy.ts` — this package must not depend
 * on the SPA — but the substance (TED attribution required by Commission
 * Decision 2011/833/EU, and the decision-support disclaimer required by
 * docs/product-scope.md's product-truth rules) mirrors it. Wording here is
 * the pre-existing digest footer copy, hoisted unchanged so both the
 * digest and the auth emails share one source of truth.
 */

export const NOTIFICATIONS_TED_ATTRIBUTION =
  "Source: Tenders Electronic Daily (TED), the EU's public procurement portal " +
  '(Decision 2011/833/EU on the reuse of Commission documents).';

export const NOTIFICATIONS_DECISION_SUPPORT_DISCLAIMER =
  'Scores and flags are decision support, not legal or procurement advice — ' +
  'always verify against the original notice before bidding.';

export const SUPPORT_EMAIL = 'support@bidmorrow.com';
