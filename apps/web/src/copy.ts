/**
 * Marketing copy constants shared by the SPA shell.
 *
 * Sources:
 * - Headline/subheadline: docs/product-scope.md.
 * - TED attribution: docs/ted-data-source.md (source acknowledgement required by
 *   Commission Decision 2011/833/EU).
 * - Disclaimer: docs/product-scope.md product-truth rules (decision support only).
 */

export const PRODUCT_NAME = 'BidMorrow';

export const HEADLINE = 'Find the tenders worth pursuing. Skip the rest.';

export const SUBHEADLINE =
  'BidMorrow is bid/no-bid qualification intelligence for EU public procurement. It answers one question: “Should a company like mine spend time investigating this tender?”';

export const TED_ATTRIBUTION =
  'Source of procurement notices: Tenders Electronic Daily (TED), Publications Office of the European Union.';

export const DECISION_SUPPORT_DISCLAIMER =
  'BidMorrow is decision support — it does not guarantee eligibility, compliance, award, or the completeness or accuracy of source notices; always verify requirements in the original procurement documents.';

/**
 * Scoped-coverage statement: docs/product-scope.md product-truth rules
 * ("Coverage is scoped and documented — never imply exhaustive EU
 * coverage") and docs/ted-ingestion-scope.md (V1 default CPV scope).
 */
export const SCOPED_COVERAGE_STATEMENT =
  'BidMorrow ingests EU public procurement competition notices from TED within a documented, configured CPV scope — currently IT services (CPV 72*), software packages and information systems (CPV 48*), and a small reviewed extras list (safety consultancy, CPV 79417000). This is scoped coverage, not exhaustive EU coverage: a notice outside this scope is never ingested or scored, regardless of how well it might otherwise fit your profile.';

/**
 * CPV pre-filter disclosure — required by docs/matching-engine.md
 * "[disclosed: methodology page, Phase 7]".
 */
export const CPV_PREFILTER_DISCLOSURE =
  'Before any tender is scored, BidMorrow checks whether its CPV code shares a CPV division (the first two digits) with at least one of your declared CPV preferences. Only tenders that pass this check are scored at all — a tender with zero CPV division overlap is never scored, even if its geography, value, buyer, or keywords would otherwise fit well. This trade-off keeps your feed relevant and keeps the product affordable to run, but it means a narrow CPV preference list can cause BidMorrow to miss a tender that would genuinely interest you. Review your CPV preferences periodically, and widen them if your feed seems too quiet.';

export const UNKNOWN_POLICY_STATEMENT =
  'When a data point needed for a score component is missing from the published notice (for example, no value or no deadline), BidMorrow never guesses and never scores it as zero or as a perfect match. Instead it applies a documented neutral score — half of that component’s maximum points — and marks the component "Unknown" in the score breakdown, with an explanation of what was missing.';

export const HARD_EXCLUSIONS_STATEMENT =
  'A tender is excluded outright (no score shown) only when a KNOWN value trips one of five rules: the lot’s country/region is in your excluded geographies, its CPV code falls in an excluded CPV family, an excluded phrase appears in the notice text, its contract nature is one you’ve marked unsupported, or its deadline runway is below your configured threshold. Unknown fields never trigger an exclusion — only fields BidMorrow can actually read from the notice do.';

export const RISK_FLAG_STATEMENT =
  'Risk flags are deterministic pattern matches over the notice text (certifications, security clearance, insurance, financial turnover, prior experience, framework membership, local presence, mandatory references) — never an LLM guess. Each flag quotes the exact source text it was detected from and is labelled either "Confirmed pattern" or "Possible requirement detected — verify in source documents." BidMorrow never asserts a requirement exists without quoting the evidence it found.';
