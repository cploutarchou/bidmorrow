/**
 * @bidmorrow/procurement — source-agnostic ingestion orchestration.
 *
 * Phase 2 skeleton: orchestration, checkpoints, and retention arrive in
 * Phase 5. This module owns the ingestion-run status vocabulary
 * (docs/data-model.md §5, `ingestion_runs.status`).
 */

export const PACKAGE = '@bidmorrow/procurement';

/**
 * Lifecycle of one ingestion run. A run is never falsely `succeeded`:
 * `partial` marks runs with row-level errors that did not abort the batch.
 */
export const INGESTION_RUN_STATUSES = ['running', 'succeeded', 'partial', 'failed'] as const;

export type IngestionRunStatus = (typeof INGESTION_RUN_STATUSES)[number];

// Phase 5 stage B: orchestration composing @bidmorrow/ted + @bidmorrow/db.
export * from './scope';
export * from './country-map';
export * from './value';
export * from './snapshot';
export * from './search-row';
export * from './checkpoint-windows';
export * from './retention-eligibility';
export * from './run-window';
export * from './catch-up';
export * from './purge';
export * from './org-purge';
export * from './health';
export * from './ecb';
export * from './scoring-input';
export * from './score';
