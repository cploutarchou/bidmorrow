/**
 * Ingestion scope (docs/ted-ingestion-scope.md, ADR-0003): CPV families +
 * optional country filter, admin-adjustable via `feature_flags` without a
 * deploy. Code carries only the DEFAULT — the flag is seeded lazily (there
 * is no seed migration; `loadIngestionScope` falls back to the default when
 * the flag row does not exist yet, exactly like every other flag reader in
 * this codebase).
 */
import {
  FLAG_FETCH_RETRY_ATTEMPTS_SUSPENDED,
  FLAG_INGESTION_CPV_SCOPE,
  FLAG_INGESTION_PAUSED,
} from '@bidmorrow/config';
import { getFeatureFlag } from '@bidmorrow/db';
import type { Db } from '@bidmorrow/db';
import type { Logger } from '@bidmorrow/observability';

export interface IngestionScope {
  /**
   * CPV entries: either a family root (`'72'`, `'48'` — matched as a
   * prefix) or a full 8-digit code (`'79417000'` — matched exactly).
   */
  readonly cpvFamilies: readonly string[];
  /** ISO-3166-1 alpha-2 buyer-country filter; empty = no country filter. */
  readonly countries: readonly string[];
}

/** V1 default scope (docs/ted-ingestion-scope.md): 72* + 48* + 79417000, no country filter. */
export const DEFAULT_INGESTION_SCOPE: IngestionScope = {
  cpvFamilies: ['72', '48', '79417000'],
  countries: [],
};

function isStringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((v) => typeof v === 'string');
}

/** Parses the `ingestion_cpv_scope` flag's JSON value; throws on a malformed shape (never silently ignored). */
export function parseIngestionScope(valueJson: string): IngestionScope {
  const parsed: unknown = JSON.parse(valueJson);
  if (typeof parsed !== 'object' || parsed === null) {
    throw new Error('ingestion_cpv_scope flag value must be a JSON object');
  }
  const record = parsed as Record<string, unknown>;
  const cpvFamilies = record['cpvFamilies'];
  const countries = record['countries'] ?? [];
  if (!isStringArray(cpvFamilies) || cpvFamilies.length === 0) {
    throw new Error('ingestion_cpv_scope.cpvFamilies must be a non-empty string array');
  }
  if (!isStringArray(countries)) {
    throw new Error('ingestion_cpv_scope.countries must be a string array');
  }
  return { cpvFamilies, countries };
}

/** Reads the current ingestion scope, falling back to the code default when unset. */
export async function loadIngestionScope(db: Db): Promise<IngestionScope> {
  const flag = await getFeatureFlag(db, FLAG_INGESTION_CPV_SCOPE);
  if (flag === null) {
    return DEFAULT_INGESTION_SCOPE;
  }
  return parseIngestionScope(flag.valueJson);
}

/**
 * Reads the `ingestion_paused` flag; absent/malformed defaults to NOT
 * paused. This is a deliberate availability-over-strictness choice: the pause
 * flag exists as an emergency stop lever (e.g. to halt ingestion mid-incident
 * without a deploy), so a malformed flag value must never itself become an
 * outage by silently halting ingestion — it is logged instead so the anomaly
 * is visible without changing the fail-open behavior.
 */
export async function isIngestionPaused(db: Db, logger?: Logger): Promise<boolean> {
  const flag = await getFeatureFlag(db, FLAG_INGESTION_PAUSED);
  if (flag === null) {
    return false;
  }
  try {
    return JSON.parse(flag.valueJson) === true;
  } catch (cause) {
    logger?.warn('ingestion.paused_flag.malformed', {
      value_json: flag.valueJson,
      error: cause instanceof Error ? cause.message : String(cause),
    });
    return false;
  }
}

/**
 * Reads the `fetch_retry_attempts_suspended` flag (ADR-0010 §5.2);
 * absent/malformed defaults to NOT suspended. Fail-open for the same reason
 * `isIngestionPaused` does: a malformed value must not silently change drain
 * semantics. The safe default here is normal ADR-0008 §3 behavior, because
 * suspension is the exceptional posture an operator opts into during a
 * confirmed upstream outage.
 */
export async function isFetchRetryAttemptsSuspended(db: Db, logger?: Logger): Promise<boolean> {
  const flag = await getFeatureFlag(db, FLAG_FETCH_RETRY_ATTEMPTS_SUSPENDED);
  if (flag === null) {
    return false;
  }
  try {
    return JSON.parse(flag.valueJson) === true;
  } catch (cause) {
    logger?.warn('ingestion.fetch_retry_suspended_flag.malformed', {
      value_json: flag.valueJson,
      error: cause instanceof Error ? cause.message : String(cause),
    });
    return false;
  }
}

export interface PublicationWindow {
  /** `YYYY-MM-DD` inclusive. */
  readonly windowFrom: string;
  /** `YYYY-MM-DD` inclusive. */
  readonly windowTo: string;
}

/**
 * The live API's `publication-date` value pattern is
 * `[0-9]{8}|today([+-]?[0-9]*)` (QUERY_INVALID_FIELD_FORMAT response,
 * verified via the ted-gates checkQuerySyntax run 2026-08-16) — dates must
 * be compact `YYYYMMDD`, never ISO `YYYY-MM-DD`. Internal window handling
 * (checkpoints, R2 keys, logs) stays ISO; conversion happens only here at
 * the query boundary.
 */
function toTedDate(isoDate: string): string {
  return isoDate.replaceAll('-', '');
}

/**
 * Composes the TED expert query for one bounded ingestion window
 * (docs/ted-data-source.md §Expert query language). LIVE-VALIDATED
 * 2026-08-16 via the Phase 13 ted-gates workflow (checkQuerySyntax): two
 * corrections came out of that run — no `ASC` after `SORT BY`, and
 * compact `YYYYMMDD` dates (see `toTedDate`).
 */
export function buildScopeQuery(scope: IngestionScope, window: PublicationWindow): string {
  const cpvTerms = scope.cpvFamilies.map((entry) => (entry.length >= 8 ? entry : `${entry}*`));
  const clauses = [
    `classification-cpv IN (${cpvTerms.join(', ')})`,
    'form-type = competition',
    `publication-date >= ${toTedDate(window.windowFrom)}`,
    `publication-date <= ${toTedDate(window.windowTo)}`,
  ];
  if (scope.countries.length > 0) {
    clauses.push(`buyer-country IN (${scope.countries.join(', ')})`);
  }
  // No direction token: the live API rejects `SORT BY publication-date ASC`
  // ("extraneous input 'ASC' expecting <EOF>", verified via the Phase 13
  // ted-gates workflow's checkQuerySyntax run 2026-08-16) — the grammar is
  // `SORT BY <field>` only, matching docs/ted-data-source.md's example.
  // Order within a single-day window is not correctness-relevant anyway:
  // every window is fully iterated and upserts are idempotent.
  return `${clauses.join(' AND ')} SORT BY publication-date`;
}
