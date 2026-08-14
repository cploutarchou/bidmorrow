/**
 * Core enums / literal unions shared across packages.
 *
 * Each union is derived from a `const` tuple so callers get both the type
 * (for signatures) and the runtime list (for CHECK constraints, zod enums,
 * exhaustive iteration in tests).
 *
 * Naming follows docs/data-model.md: UPPER_SNAKE for domain classifications,
 * lower_snake for source/lifecycle-style values.
 */

/** Procurement data sources. V1 is TED-only (ADR-0001, ADR-0003). */
export const NOTICE_SOURCES = ['ted'] as const;
export type NoticeSource = (typeof NOTICE_SOURCES)[number];

/** eForms contract nature (BT-23), docs/ted-data-source.md. */
export const CONTRACT_NATURES = ['services', 'supplies', 'works'] as const;
export type ContractNature = (typeof CONTRACT_NATURES)[number];

/** Match classification bands, docs/data-model.md `tender_matches.classification`. */
export const MATCH_CLASSIFICATIONS = [
  'STRONG_MATCH',
  'WORTH_REVIEWING',
  'POSSIBLE_MATCH',
  'LOW_FIT',
  'EXCLUDED',
] as const;
export type MatchClassification = (typeof MATCH_CLASSIFICATIONS)[number];

/** Per-component scoring status, docs/data-model.md `match_components.status`. */
export const COMPONENT_STATUSES = ['MATCHED', 'PARTIAL', 'NO_MATCH', 'UNKNOWN'] as const;
export type ComponentStatus = (typeof COMPONENT_STATUSES)[number];

/** Risk-flag confidence, docs/data-model.md `match_risk_flags.confidence`. */
export const RISK_CONFIDENCES = ['HIGH', 'POSSIBLE'] as const;
export type RiskConfidence = (typeof RISK_CONFIDENCES)[number];
