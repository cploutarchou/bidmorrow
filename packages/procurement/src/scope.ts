/**
 * Ingestion scope (docs/ted-ingestion-scope.md, ADR-0003): CPV families +
 * optional country filter, admin-adjustable via `feature_flags` without a
 * deploy. Code carries only the DEFAULT — the flag is seeded lazily (there
 * is no seed migration; `loadIngestionScope` falls back to the default when
 * the flag row does not exist yet, exactly like every other flag reader in
 * this codebase).
 */
import { FLAG_INGESTION_CPV_SCOPE, FLAG_INGESTION_PAUSED } from '@bidmorrow/config';
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

export interface PublicationWindow {
  /** `YYYY-MM-DD` inclusive. */
  readonly windowFrom: string;
  /** `YYYY-MM-DD` inclusive. */
  readonly windowTo: string;
}

/**
 * Composes the TED expert query for one bounded ingestion window
 * (docs/ted-data-source.md §Expert query language). SYNTAX PENDING LIVE
 * VALIDATION: the exact `classification-cpv IN (...)` wildcard/family-root
 * form and field names below follow the documented grammar but have not
 * been round-tripped through the live `checkQuerySyntax` endpoint (TED API
 * unreachable from this environment — see IMPLEMENTATION_LEDGER Phase 5
 * notes). The ted-data agent must validate this against staging before the
 * first production cron run.
 */
export function buildScopeQuery(scope: IngestionScope, window: PublicationWindow): string {
  const cpvTerms = scope.cpvFamilies.map((entry) => (entry.length >= 8 ? entry : `${entry}*`));
  const clauses = [
    `classification-cpv IN (${cpvTerms.join(', ')})`,
    'form-type = competition',
    `publication-date >= ${window.windowFrom}`,
    `publication-date <= ${window.windowTo}`,
  ];
  if (scope.countries.length > 0) {
    clauses.push(`buyer-country IN (${scope.countries.join(', ')})`);
  }
  return `${clauses.join(' AND ')} SORT BY publication-date ASC`;
}
