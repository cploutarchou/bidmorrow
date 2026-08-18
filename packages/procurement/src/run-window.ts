/**
 * Ingestion orchestration: composes `@bidmorrow/ted` (client + parser) with
 * `@bidmorrow/db` (checkpointed, idempotent persistence) into one bounded
 * publication-date-window run (ted-ingestion-audit checklist items 1–7).
 */
import {
  TED_SOURCE_ID,
  TedBudgetExceededError,
  TedParseError,
  TedRequestError,
  TedXmlTooLargeError,
} from '@bidmorrow/ted';
import type { ParseIssue, TedClient } from '@bidmorrow/ted';
import type { Logger } from '@bidmorrow/observability';
import type { Db, IngestionRun, IngestionRunTerminalStatus } from '@bidmorrow/db';
import {
  advanceCheckpoint,
  finishRun,
  getLatestVersionNumber,
  getNoticeByPublicationNumber,
  createRun,
  insertCpvCodes,
  insertGeographies,
  insertLots,
  insertSnapshotIfNewHash,
  recordError,
  upsertBuyer,
  upsertNoticeWithVersion,
} from '@bidmorrow/db';
import { parseEformsNotice } from '@bidmorrow/ted';

import { normalizeBuyerCountry } from './country-map';
import { extractSearchRow } from './search-row';
import type { SearchRowFields } from './search-row';
import { buildScopeQuery } from './scope';
import type { IngestionScope, PublicationWindow } from './scope';
import { buildSnapshotR2Key, gzipText, sha256Hex } from './snapshot';
import { deriveValueEur, divideValueAcrossLots } from './value';

/** Search API fields the orchestrator requires (docs/ted-data-source.md field map). */
export const SEARCH_FIELDS = ['publication-number', 'publication-date', 'links'] as const;

/** Notices per search page (max 250 per the documented API cap). */
const SEARCH_PAGE_LIMIT = 250;

export interface RunWindowDeps {
  readonly db: Db;
  readonly client: TedClient;
  /** R2 bucket binding for raw-XML snapshots (ADR-0005). */
  readonly snapshots: R2Bucket;
  readonly logger: Logger;
  readonly scope: IngestionScope;
  /** Injected clock (test seam); defaults to `Date.now`. */
  readonly now?: () => number;
}

export interface RunWindowResult {
  readonly run: IngestionRun;
  readonly status: IngestionRunTerminalStatus;
  /**
   * Ids of every lot freshly inserted in this window — from brand-new
   * notices AND from a corrected notice's new current version (TED-P5-03).
   * The caller (worker `queue()`) enqueues these to `MATCH_QUEUE` after a
   * successful/partial window; scoring itself is Phase 6's decoupled,
   * asynchronous concern, never run inline here.
   */
  readonly newLotIds: readonly string[];
}

interface MutableCounts {
  noticesSeen: number;
  noticesUpserted: number;
  versionsCreated: number;
  lotsCreated: number;
  /**
   * Scoring is decoupled from ingestion (Phase 6): a window enqueues its new
   * lot ids to `MATCH_QUEUE` and returns before any scoring happens, so
   * `matches_scored` on THIS `ingestion_runs` row is honestly always 0 —
   * nothing was scored during the run. The scored-pair count for a scoring
   * pass is observable on its own `scoring.run.completed` log line
   * (packages/procurement/src/score.ts), not retrofitted onto an unrelated
   * ingestion run (a scoring pass processes lots across many prior windows,
   * so attributing its count to any single `ingestion_runs` row would be
   * misleading).
   */
  matchesScored: number;
  errorsCount: number;
}

/**
 * Runs ingestion for exactly one publication-date window. Never throws on a
 * single bad notice (routed to `ingestion_errors`, status becomes
 * `partial`); DOES throw-and-fail-the-run on window-level failures (request
 * budget exhausted, an HTTP failure surviving the client's own retries, or
 * any unexpected persistence error) — the checkpoint is only advanced when
 * the window finishes non-`failed`. A window-level failure ALSO writes one
 * durable `ingestion_errors` row (stage + machine code + message + the
 * notice/URL it died on) so the failure is fully diagnosable from D1 without
 * live worker logs.
 */
export async function runIngestionWindow(
  deps: RunWindowDeps,
  window: PublicationWindow,
): Promise<RunWindowResult> {
  const now = deps.now ?? Date.now;
  const startedAt = now();
  const run = await createRun(deps.db, {
    source: TED_SOURCE_ID,
    windowFrom: window.windowFrom,
    windowTo: window.windowTo,
    startedAt,
  });

  const counts: MutableCounts = {
    noticesSeen: 0,
    noticesUpserted: 0,
    versionsCreated: 0,
    lotsCreated: 0,
    matchesScored: 0,
    errorsCount: 0,
  };
  const newLotIds: string[] = [];
  // The notice currently mid-processing, so a window-level failure can name
  // the notice/URL it died on in the durable diagnostic below. Non-null ONLY
  // while a specific notice is in flight (cleared before search-row extraction
  // and after each notice completes), so a failure fetching the NEXT search
  // page is never mis-attributed to the last good notice.
  let currentNotice: { sourceNoticeId: string; xmlUrl: string } | null = null;

  try {
    const query = buildScopeQuery(deps.scope, window);
    for await (const page of deps.client.iterateSearch({
      query,
      fields: SEARCH_FIELDS,
      limit: SEARCH_PAGE_LIMIT,
    })) {
      for (const row of page.notices) {
        counts.noticesSeen += 1;
        currentNotice = null;
        const extracted = extractSearchRow(row);
        if (extracted === null) {
          counts.errorsCount += 1;
          await recordError(deps.db, {
            ingestionRunId: run.id,
            source: TED_SOURCE_ID,
            stage: 'fetch',
            errorCode: 'MALFORMED_SEARCH_ROW',
            message:
              'search result row missing publication-number, publication-date, or links.xml.MUL',
          });
          continue;
        }
        currentNotice = { sourceNoticeId: extracted.sourceNoticeId, xmlUrl: extracted.xmlUrl };
        await processOneNotice(deps, run.id, extracted, counts, newLotIds);
        currentNotice = null;
      }
    }
  } catch (cause) {
    deps.logger.error('ingestion.window.failed', {
      source: TED_SOURCE_ID,
      window_from: window.windowFrom,
      window_to: window.windowTo,
      source_notice_id: currentNotice?.sourceNoticeId ?? null,
      error: cause instanceof Error ? cause.message : String(cause),
    });
    // Persist a DURABLE diagnostic. A window-level failure previously left
    // NOTHING in `ingestion_errors` (only this ephemeral worker log), so an
    // operator seeing `status=failed, errors_count=0` had no way to tell WHAT
    // failed without live logs — exactly the gap the 2026-08-17 staging
    // incident hit. Recording one row makes every window failure diagnosable
    // from D1 alone ("surface, don't swallow"). Guarded: a failure to write
    // the diagnostic must never mask or replace the original error.
    await recordWindowFailure(deps, run.id, currentNotice, window, cause, counts);
    const finished = await finishRun(deps.db, {
      runId: run.id,
      status: 'failed',
      counts,
      finishedAt: now(),
    });
    // Checkpoint intentionally NOT advanced — the window did not fully succeed.
    return { run: finished, status: 'failed', newLotIds: [] };
  }

  const status: IngestionRunTerminalStatus = counts.errorsCount > 0 ? 'partial' : 'succeeded';
  const finished = await finishRun(deps.db, {
    runId: run.id,
    status,
    counts,
    finishedAt: now(),
  });
  await advanceCheckpoint(deps.db, {
    source: TED_SOURCE_ID,
    lastPublicationDate: window.windowTo,
  });
  return { run: finished, status, newLotIds };
}

/**
 * Fetches, snapshots, parses, and persists ONE notice. Parse failures
 * (`TedParseError`) are caught here and routed to `ingestion_errors` —
 * they never abort the window. Everything else (fetch/persistence errors)
 * propagates to `runIngestionWindow`'s window-level failure handling.
 */
async function processOneNotice(
  deps: RunWindowDeps,
  ingestionRunId: string,
  row: SearchRowFields,
  counts: MutableCounts,
  newLotIds: string[],
): Promise<void> {
  const existingNotice = await getNoticeByPublicationNumber(deps.db, {
    source: TED_SOURCE_ID,
    publicationNumber: row.sourceNoticeId,
  });
  const prospectiveVersion =
    existingNotice === null ? 1 : (await getLatestVersionNumber(deps.db, existingNotice.id)) + 1;

  let rawXml: string;
  try {
    rawXml = await deps.client.fetchNoticeXml(row.xmlUrl);
  } catch (cause) {
    if (!(cause instanceof TedXmlTooLargeError)) {
      throw cause;
    }
    counts.errorsCount += 1;
    await recordError(deps.db, {
      ingestionRunId,
      source: TED_SOURCE_ID,
      sourceNoticeId: row.sourceNoticeId,
      stage: 'fetch',
      errorCode: 'XML_TOO_LARGE',
      message: cause.message,
      detail: { bytes: cause.bytes, maxBytes: cause.maxBytes },
    });
    return;
  }
  const contentHash = await sha256Hex(rawXml);
  const r2Key = buildSnapshotR2Key(
    TED_SOURCE_ID,
    row.publicationDate,
    row.sourceNoticeId,
    prospectiveVersion,
  );

  const snapshotResult = await insertSnapshotIfNewHash(deps.db, {
    source: TED_SOURCE_ID,
    sourceNoticeId: row.sourceNoticeId,
    versionNumber: prospectiveVersion,
    r2Key,
    contentHash,
    sizeBytes: new TextEncoder().encode(rawXml).length,
    contentType: 'application/xml',
  });
  if (snapshotResult.created) {
    const gzipped = await gzipText(rawXml);
    await deps.snapshots.put(snapshotResult.snapshot.r2Key, gzipped, {
      httpMetadata: { contentType: 'application/gzip' },
    });
  }

  let normalized;
  try {
    normalized = parseEformsNotice(rawXml);
  } catch (cause) {
    if (!(cause instanceof TedParseError)) {
      throw cause;
    }
    counts.errorsCount += 1;
    await recordError(deps.db, {
      ingestionRunId,
      source: TED_SOURCE_ID,
      sourceNoticeId: row.sourceNoticeId,
      stage: 'parse',
      errorCode: cause.issues.find((i) => i.severity === 'error')?.code ?? 'PARSE_ERROR',
      message: cause.message,
      snapshotR2Key: snapshotResult.snapshot.r2Key,
      detail: { issues: boundIssuesForErrorDetail(cause.issues) },
    });
    return;
  }

  let buyerId: string | null = null;
  if (normalized.buyer !== null) {
    const country = normalizeBuyerCountry(normalized.buyer.country);
    if (country?.unmapped === true) {
      deps.logger.warn('ingestion.buyer_country.unmapped', {
        source_notice_id: row.sourceNoticeId,
        country: normalized.buyer.country,
      });
    }
    const buyer = await upsertBuyer(deps.db, {
      source: TED_SOURCE_ID,
      sourceBuyerId: normalized.buyer.organizationId,
      name: normalized.buyer.name,
      countryCode: country?.countryCode ?? null,
      buyerLegalType: normalized.buyer.legalTypeCode,
    });
    buyerId = buyer.id;
  }

  const upsertResult = await upsertNoticeWithVersion(deps.db, {
    source: TED_SOURCE_ID,
    // Search-API row fields OVERRIDE the parser's own fallbacks (stage A
    // open item) — the Search API is authoritative during ingestion.
    sourceNoticeId: row.sourceNoticeId,
    publicationDate: row.publicationDate,
    buyerId,
    noticeType: normalized.noticeType,
    procedureType: normalized.procedureType,
    eformsSdkVersion: normalized.eformsSdkVersion,
    sourceLanguagesJson: JSON.stringify(normalized.languages),
    sourceUrl: row.xmlUrl,
    contentHash,
    snapshotId: snapshotResult.snapshot.id,
    ingestionRunId,
  });

  if (upsertResult.noticeCreated || upsertResult.versionCreated) {
    counts.noticesUpserted += 1;
  }
  if (!upsertResult.versionCreated) {
    return; // unchanged content — no new lots to insert
  }
  counts.versionsCreated += 1;

  const values = divideValueAcrossLots(normalized.lots, normalized.procedureEstimatedValue);
  const lotRows = await insertLots(deps.db, {
    noticeVersionId: upsertResult.versionId,
    lots: normalized.lots.map((lot, index) => {
      const value = values[index];
      const amount = value?.amount ?? null;
      const currency = value?.currency ?? null;
      return {
        lotNumber: lot.lotId,
        title: firstLanguageValue(lot.title) ?? `Lot ${lot.lotId}`,
        description: firstLanguageValue(lot.description),
        contractNature: lot.contractNature,
        estimatedValueAmount: amount,
        estimatedValueCurrency: currency,
        estimatedValueEur: deriveValueEur(amount, currency),
        valueIsDerived: value?.valueIsDerived ?? false,
        deadlineAt: lot.deadline,
      };
    }),
  });
  counts.lotsCreated += lotRows.length;
  for (const lotRow of lotRows) {
    newLotIds.push(lotRow.id);
  }

  const cpvEntries: { lotId: string; cpvCode: string; isMain: boolean }[] = [];
  const geoEntries: { lotId: string; countryCode: string; nutsCode: string | null }[] = [];
  for (const [index, lotRow] of lotRows.entries()) {
    const source = normalized.lots[index];
    if (source === undefined) {
      continue;
    }
    if (source.cpv.main !== null) {
      cpvEntries.push({ lotId: lotRow.id, cpvCode: source.cpv.main, isMain: true });
    }
    for (const additional of source.cpv.additional) {
      cpvEntries.push({ lotId: lotRow.id, cpvCode: additional, isMain: false });
    }
    const buyerCountry = normalizeBuyerCountry(normalized.buyer?.country ?? null);
    if (source.nuts.length > 0) {
      for (const nuts of source.nuts) {
        geoEntries.push({
          lotId: lotRow.id,
          countryCode: nutsToCountry(nuts, buyerCountry),
          nutsCode: nuts,
        });
      }
    } else if (buyerCountry !== null) {
      geoEntries.push({ lotId: lotRow.id, countryCode: buyerCountry.countryCode, nutsCode: null });
    }
  }
  await insertCpvCodes(deps.db, { entries: dedupeCpv(cpvEntries) });
  await insertGeographies(deps.db, { entries: dedupeGeo(geoEntries) });
}

/**
 * Cap on any single free-text or URL value stored in a window-failure
 * diagnostic. `recordError` serializes `detail` to `detail_json`, and D1 caps
 * a single statement (bound values included) at ~100KB — a pathological TED
 * URL or error message must never push the insert over that cap, because the
 * write is guarded and would then be SILENTLY LOST, regressing to the exact
 * "no durable record" bug this diagnostic exists to fix. Mirrors the intent of
 * `boundIssuesForErrorDetail` for the per-notice parse path. A few short,
 * capped fields keep the whole insert comfortably within budget.
 */
export const MAX_DIAGNOSTIC_VALUE_CHARS = 2_000;

/** Truncates a diagnostic string to the cap, appending a marker when it bites. */
export function truncateForDiagnostic(value: string): string {
  return value.length <= MAX_DIAGNOSTIC_VALUE_CHARS
    ? value
    : `${value.slice(0, MAX_DIAGNOSTIC_VALUE_CHARS)}…truncated`;
}

/**
 * Maps a window-fatal error to a stable, machine-readable diagnostic. Only
 * the errors that legitimately reach the window-level catch are classified:
 * request-budget exhaustion and HTTP failures (both `fetch` stage), with
 * anything else treated as an unexpected persistence/normalization failure
 * (parse and too-large errors are handled per-notice and never arrive here).
 */
function describeWindowFailure(
  cause: unknown,
  noticeInFlight: boolean,
): {
  readonly stage: 'fetch' | 'persist';
  readonly errorCode: string;
  readonly message: string;
  readonly detail: Record<string, unknown>;
} {
  if (cause instanceof TedBudgetExceededError) {
    return {
      stage: 'fetch',
      errorCode: 'REQUEST_BUDGET_EXCEEDED',
      message: cause.message,
      detail: { requestsUsed: cause.requestsUsed, maxRequestsPerRun: cause.maxRequestsPerRun },
    };
  }
  if (cause instanceof TedRequestError) {
    // A stable code per failure shape so alerting can group them: which
    // request died (a notice-XML fetch vs the search endpoint — the latter
    // is the only TedRequestError source when no notice is in flight), then
    // network-level (no status) vs a specific HTTP status.
    const prefix = noticeInFlight ? 'NOTICE_FETCH' : 'SEARCH_FETCH';
    return {
      stage: 'fetch',
      errorCode:
        cause.status === null ? `${prefix}_NETWORK_ERROR` : `${prefix}_HTTP_${cause.status}`,
      message: truncateForDiagnostic(cause.message),
      detail: {
        url: truncateForDiagnostic(cause.url),
        status: cause.status,
        attempts: cause.attempts,
      },
    };
  }
  return {
    stage: 'persist',
    errorCode: 'UNEXPECTED_WINDOW_ERROR',
    message: truncateForDiagnostic(cause instanceof Error ? cause.message : String(cause)),
    detail: cause instanceof Error ? { errorName: cause.name } : {},
  };
}

/**
 * Writes the durable `ingestion_errors` diagnostic for a window-level failure
 * and bumps `errorsCount` so the run's counter matches the persisted row.
 * Fully guarded: if the diagnostic write itself fails (e.g. the failure that
 * killed the window was D1 being unavailable), it is logged and swallowed —
 * the ORIGINAL error still propagates to `finishRun('failed')`, never masked.
 */
async function recordWindowFailure(
  deps: RunWindowDeps,
  ingestionRunId: string,
  currentNotice: { sourceNoticeId: string; xmlUrl: string } | null,
  window: PublicationWindow,
  cause: unknown,
  counts: MutableCounts,
): Promise<void> {
  const diag = describeWindowFailure(cause, currentNotice !== null);
  try {
    await recordError(deps.db, {
      ingestionRunId,
      source: TED_SOURCE_ID,
      sourceNoticeId: currentNotice?.sourceNoticeId ?? null,
      stage: diag.stage,
      errorCode: diag.errorCode,
      message: diag.message,
      detail: {
        ...diag.detail,
        ...(currentNotice === null
          ? {}
          : { noticeXmlUrl: truncateForDiagnostic(currentNotice.xmlUrl) }),
        windowFrom: window.windowFrom,
        windowTo: window.windowTo,
      },
    });
    counts.errorsCount += 1;
  } catch (recordCause) {
    deps.logger.error('ingestion.window.failed.diagnostic_write_failed', {
      source: TED_SOURCE_ID,
      error: recordCause instanceof Error ? recordCause.message : String(recordCause),
    });
  }
}

/**
 * D1 caps a single statement (including bound-parameter values) at ~100KB.
 * `detail_json` is the only unbounded field in a `recordError` insert — a
 * pathological notice (many lots, each producing several issues) must never
 * be able to blow that cap. Issues are kept in order and dropped from the
 * tail once the running JSON size would exceed the budget; a boolean marker
 * records that truncation happened so the operator knows more issues exist
 * (retrievable from the archived R2 snapshot via `snapshotR2Key`).
 */
export const MAX_ISSUES_DETAIL_JSON_CHARS = 50_000;

/** Exported for direct unit testing of the truncation cap; internal callers use it via `recordError`. */
export function boundIssuesForErrorDetail(issues: readonly ParseIssue[]): readonly unknown[] {
  const fullJson = JSON.stringify(issues);
  if (fullJson.length <= MAX_ISSUES_DETAIL_JSON_CHARS) {
    return issues;
  }
  const kept: ParseIssue[] = [];
  let runningLength = 2; // '[' + ']'
  const marker = '...truncated';
  const markerLength = JSON.stringify(marker).length + 1;
  for (const issue of issues) {
    const entryLength = JSON.stringify(issue).length + 1; // + comma/bracket
    if (runningLength + entryLength + markerLength > MAX_ISSUES_DETAIL_JSON_CHARS) {
      break;
    }
    kept.push(issue);
    runningLength += entryLength;
  }
  return [...kept, marker];
}

/** First value from a `{lang: text}` map (deterministic key order is not guaranteed; any variant is fine for a display title). */
function firstLanguageValue(map: Readonly<Record<string, string>> | null): string | null {
  if (map === null) {
    return null;
  }
  const first = Object.values(map)[0];
  return first ?? null;
}

/** NUTS codes are country-prefixed (first 2 letters); falls back to the buyer country when a NUTS code is too short to trust. */
function nutsToCountry(nuts: string, buyerCountry: { countryCode: string } | null): string {
  const prefix = nuts.slice(0, 2).toUpperCase();
  return /^[A-Z]{2}$/.test(prefix) ? prefix : (buyerCountry?.countryCode ?? prefix);
}

function dedupeCpv<T extends { lotId: string; cpvCode: string }>(entries: T[]): T[] {
  const seen = new Set<string>();
  return entries.filter((e) => {
    const key = `${e.lotId}:${e.cpvCode}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function dedupeGeo<T extends { lotId: string; countryCode: string; nutsCode: string | null }>(
  entries: T[],
): T[] {
  const seen = new Set<string>();
  return entries.filter((e) => {
    const key = `${e.lotId}:${e.countryCode}:${e.nutsCode ?? ''}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}
