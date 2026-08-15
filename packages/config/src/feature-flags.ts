/**
 * Feature-flag key constants (docs/data-model.md `feature_flags.key`).
 * Runtime flag values live in the database and are admin-edited; code refers
 * to flags only through these constants so keys stay grep-auditable.
 */

export const FLAG_FOUNDING_PLAN_OPEN = 'founding_plan_open';
export const FLAG_INGESTION_PAUSED = 'ingestion_paused';
export const FLAG_DIGEST_PAUSED = 'digest_paused';
/**
 * Ingestion CPV/country scope (docs/ted-ingestion-scope.md, ADR-0003).
 * Value shape: `{"cpvFamilies":["72","48","79417000"],"countries":[]}`.
 * Absent = code default (packages/procurement `DEFAULT_INGESTION_SCOPE`).
 */
export const FLAG_INGESTION_CPV_SCOPE = 'ingestion_cpv_scope';

export const FEATURE_FLAG_KEYS = [
  FLAG_FOUNDING_PLAN_OPEN,
  FLAG_INGESTION_PAUSED,
  FLAG_DIGEST_PAUSED,
  FLAG_INGESTION_CPV_SCOPE,
] as const;

export type FeatureFlagKey = (typeof FEATURE_FLAG_KEYS)[number];
