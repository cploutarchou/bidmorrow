/**
 * Ingestion orchestration: composes `@bidmorrow/ted` (client + parser) with
 * `@bidmorrow/db` (checkpointed, idempotent persistence) into one bounded
 * publication-date-window run (ted-ingestion-audit checklist items 1–7).
 */
import {
  TED_SOURCE_ID,
  TedBudgetExceededError,
  TedParseError,
  TedRenderPendingError,
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
  upsertFetchRetry,
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

/**
 * Search API fields the orchestrator requires (docs/ted-data-source.md field
 * map). `OJ` (ADR-0010 §5.3) is the authoritative OJ S gazette issue a notice
 * was published in — the key that maps a notice to its daily bulk package
 * (`/packages/daily/{ojIssueId}`), and useful provenance regardless of which
 * acquisition channel is active. Cap check: `fields.length * limit` must stay
 * <= 10,000; 4 * 250 = 1,000.
 */
export const SEARCH_FIELDS = ['publication-number', 'publication-date', 'links', 'OJ'] as const;

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
  /**
   * Minimum ms before REVISITING a notice whose XML render is still pending
   * (TED's async front-end — see `TedRenderPendingError`). Default
   * `RENDER_RETRY_DELAY_MS`; tests inject 0. Only bites when the work queue
   * is so short that cycling alone doesn't provide the delay.
   */
  readonly renderRetryDelayMs?: number;
}

/** Default minimum delay before revisiting a render-pending notice. */
export const RENDER_RETRY_DELAY_MS = 20_000;

/**
 * Maximum visits per notice for the render-pending cycle (first visit
 * triggers the render; later visits collect the cached document). Every
 * queued notice is visited once before any notice is visited twice, so even
 * when a notice exhausts its visits, ALL renders were already triggered. A
 * notice that still exhausts is skipped (record-and-continue, ADR-0008
 * Amendment §A1) rather than failing the window — the next daily drain
 * (§A2) re-attempts it from TED's cache with a fresh visit budget.
 * Bumped 4 -> 6 (ADR-0008 Amendment §A3): the 2026-08-19 staging incident
 * showed 4 visits (~4 min full-queue horizon) insufficient for at least one
 * real render; 6 visits extends the horizon to ~8-10 min at current volume.
 */
export const MAX_RENDER_VISITS = 6;

/**
 * Systemic-fetch-failure threshold (ADR-0008 §2): record-and-continue for
 * per-notice fetch failures is bounded so a genuinely systemic problem (TED
 * blocking/outage) still fails the window and holds the checkpoint, rather
 * than silently degrading into "skip everything". Code constants, not a
 * `feature_flags` entry (§2's location rationale — a correctness parameter,
 * not an operator-tunable lever; `ingestion_paused` already covers the
 * runtime emergency case).
 */
export const FETCH_FAILURE_FAIL_MIN = 5;
export const FETCH_FAILURE_FAIL_RATIO = 0.2;

/**
 * Pure threshold check (ADR-0008 §2), evaluated after each record-and-
 * continue skip: `noticesFetchFailed >= FETCH_FAILURE_FAIL_MIN` AND
 * `noticesFetchFailed / noticesSeen > FETCH_FAILURE_FAIL_RATIO`. Exported
 * for direct unit testing without a database.
 */
export function isFetchFailureThresholdExceeded(
  noticesFetchFailed: number,
  noticesSeen: number,
): boolean {
  return (
    noticesFetchFailed >= FETCH_FAILURE_FAIL_MIN &&
    noticesSeen > 0 &&
    noticesFetchFailed / noticesSeen > FETCH_FAILURE_FAIL_RATIO
  );
}

/**
 * Degraded-render alert thresholds (ADR-0009 §1) — NOT a fail ceiling.
 * Evaluated ONCE at window end (never per-skip; there is no abort). Same
 * location rationale as §2's constants: a correctness/alerting parameter,
 * not an operator-tunable `feature_flags` lever.
 */
export const RENDER_PENDING_DEGRADED_MIN = 5;
export const RENDER_PENDING_DEGRADED_RATIO = 0.2;

/**
 * Pure threshold check (ADR-0009 §1) for the `RENDER_PENDING_DEGRADED`
 * signal: `noticesRenderPending >= RENDER_PENDING_DEGRADED_MIN` AND
 * `noticesRenderPending / noticesSeen > RENDER_PENDING_DEGRADED_RATIO`.
 * Exported for direct unit testing without a database. Unlike
 * `isFetchFailureThresholdExceeded`, a `true` result never aborts anything —
 * it only decides whether the window-end diagnostic row/log fires.
 */
export function isRenderPendingDegraded(
  noticesRenderPending: number,
  noticesSeen: number,
): boolean {
  return (
    noticesRenderPending >= RENDER_PENDING_DEGRADED_MIN &&
    noticesSeen > 0 &&
    noticesRenderPending / noticesSeen > RENDER_PENDING_DEGRADED_RATIO
  );
}

/**
 * Internal signal thrown when `isFetchFailureThresholdExceeded` trips
 * (ADR-0008 §2). Caught by `runIngestionWindow`'s existing window-level
 * handler and mapped to the durable `FETCH_FAILURE_THRESHOLD_EXCEEDED`
 * diagnostic by `describeWindowFailure` — never thrown across a package
 * boundary, so it is not exported.
 */
class FetchFailureThresholdError extends Error {
  readonly noticesFetchFailed: number;
  readonly noticesSeen: number;

  constructor(noticesFetchFailed: number, noticesSeen: number) {
    super(
      `fetch failure threshold exceeded: ${String(noticesFetchFailed)}/${String(noticesSeen)} ` +
        'notices failed to fetch this window',
    );
    this.name = 'FetchFailureThresholdError';
    this.noticesFetchFailed = noticesFetchFailed;
    this.noticesSeen = noticesSeen;
  }
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
  /**
   * ADR-0009 §2: the `describeWindowFailure` machine error code for a
   * `failed` window, `null` otherwise (including `succeeded`/`partial`).
   * Lets `catch-up.ts` classify WHY the window failed (`isSystemicWindowFailure`)
   * instead of treating every `failed` status alike when deciding whether to
   * skip the drain.
   */
  readonly failureCode: string | null;
}

/** Exported so the ADR-0008 §3/A2 drain (fetch-retry-drain.ts) can build its own counts object for `processOneNotice`. */
export interface MutableCounts {
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
  /**
   * GENUINE per-notice XML fetch failures recorded as record-and-continue
   * skips (`NOTICE_FETCH_HTTP_*` / `NOTICE_FETCH_NETWORK_ERROR` — origin
   * refusing/failing us) — a subset of `errorsCount`. Drives the §2 systemic
   * threshold (ADR-0009 §1: render-pending exhaustion no longer does) and is
   * passed through to `finishRun` so watchdog/admin can distinguish "healthy
   * partial" from "systemically degraded".
   */
  noticesFetchFailed: number;
  /**
   * Render-pending exhaustion skips (ADR-0009 §1): `NOTICE_RENDER_PENDING`
   * after `MAX_RENDER_VISITS` — the origin is COOPERATING (202/accepted,
   * just slow), not refusing us, so this counter has NO fail ceiling and
   * never feeds the §2 threshold. Still a durable `ingestion_errors` row and
   * an idempotent retry-table upsert per skip (no notice ever loses its
   * retry row); evaluated once at window end against
   * `RENDER_PENDING_DEGRADED_MIN`/`RENDER_PENDING_DEGRADED_RATIO` for the
   * distinct `RENDER_PENDING_DEGRADED` alert row.
   */
  noticesRenderPending: number;
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
    noticesFetchFailed: 0,
    noticesRenderPending: 0,
  };
  const newLotIds: string[] = [];
  // The notice currently mid-processing, so a window-level failure can name
  // the notice/URL it died on in the durable diagnostic below. Non-null ONLY
  // while a specific notice is in flight (cleared before search-row extraction
  // and after each notice completes), so a failure fetching the NEXT search
  // page is never mis-attributed to the last good notice.
  let currentNotice: { sourceNoticeId: string; xmlUrl: string } | null = null;

  try {
    // Phase 1 — collect every in-scope search row (cheap; pages are just
    // metadata). Malformed rows are recorded here and dropped.
    const query = buildScopeQuery(deps.scope, window);
    const workQueue: { row: SearchRowFields; visits: number; notBefore: number }[] = [];
    for await (const page of deps.client.iterateSearch({
      query,
      fields: SEARCH_FIELDS,
      limit: SEARCH_PAGE_LIMIT,
      // ADR-0010 §5.1 — pinned, not left to the upstream default. Corrections
      // are new publications in our version model (`tender_notice_versions`
      // never overwrites, content-hash dedupes unchanged content, recompute
      // triggers on new versions), so we need EVERY published version. The
      // observed default already behaves this way, but if it ever flipped we
      // would silently lose the superseded versions and their history.
      onlyLatestVersions: false,
    })) {
      for (const row of page.notices) {
        counts.noticesSeen += 1;
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
        workQueue.push({ row: extracted, visits: 0, notBefore: 0 });
      }
    }

    // Phase 2 — process the queue. A notice whose XML render is still
    // pending (TED's async front-end answers 202 / empty body until the
    // render it just queued completes) is requeued to the TAIL, so every
    // notice is visited once (triggering all renders) before any is visited
    // twice (collecting them). `renderRetryDelayMs` guards the short-queue
    // case where cycling alone would revisit too quickly.
    const renderRetryDelayMs = deps.renderRetryDelayMs ?? RENDER_RETRY_DELAY_MS;
    while (workQueue.length > 0) {
      const entry = workQueue.shift();
      if (entry === undefined) break;
      const waitMs = entry.notBefore - now();
      if (waitMs > 0) {
        await new Promise((resolve) => {
          setTimeout(resolve, waitMs);
        });
      }
      currentNotice = { sourceNoticeId: entry.row.sourceNoticeId, xmlUrl: entry.row.xmlUrl };
      try {
        await processOneNotice(deps, run.id, entry.row, counts, newLotIds, now);
      } catch (cause) {
        if (!(cause instanceof TedRenderPendingError)) {
          throw cause;
        }
        entry.visits += 1;
        if (entry.visits >= MAX_RENDER_VISITS) {
          // Exhausted: record-and-continue (ADR-0008 Amendment §A1, ADR-0009
          // §1) — durable diagnostic + retry row, exactly like a genuine
          // fetch failure, but counted separately: the origin is
          // COOPERATING (202, render just slow), not refusing us, so this
          // path has NO fail ceiling and never evaluates the §2 threshold.
          await recordRenderPendingSkip(
            deps,
            run.id,
            entry.row,
            counts,
            cause.message,
            { url: truncateForDiagnostic(cause.url), status: cause.status, visits: entry.visits },
            now,
          );
        } else {
          entry.notBefore = now() + renderRetryDelayMs;
          workQueue.push(entry);
          deps.logger.info('ingestion.notice_render.pending', {
            source_notice_id: entry.row.sourceNoticeId,
            visits: entry.visits,
            queue_length: workQueue.length,
          });
        }
      }
      currentNotice = null;
    }
  } catch (cause) {
    deps.logger.error('ingestion.window.failed', {
      source: TED_SOURCE_ID,
      window_from: window.windowFrom,
      window_to: window.windowTo,
      source_notice_id: currentNotice?.sourceNoticeId ?? null,
      error: cause instanceof Error ? cause.message : String(cause),
    });
    if (cause instanceof FetchFailureThresholdError) {
      // ADR-0008 §5: distinct alertable log line so watchdog/on-call can
      // group threshold breaches without parsing the generic failure line.
      deps.logger.error('ingestion.window.fetch_failure_threshold', {
        source: TED_SOURCE_ID,
        window_from: window.windowFrom,
        window_to: window.windowTo,
        notices_fetch_failed: cause.noticesFetchFailed,
        notices_seen: cause.noticesSeen,
      });
    }
    // Persist a DURABLE diagnostic. A window-level failure previously left
    // NOTHING in `ingestion_errors` (only this ephemeral worker log), so an
    // operator seeing `status=failed, errors_count=0` had no way to tell WHAT
    // failed without live logs — exactly the gap the 2026-08-17 staging
    // incident hit. Recording one row makes every window failure diagnosable
    // from D1 alone ("surface, don't swallow"). Guarded: a failure to write
    // the diagnostic must never mask or replace the original error.
    const failureCode = await recordWindowFailure(
      deps,
      run.id,
      currentNotice,
      window,
      cause,
      counts,
    );
    const finished = await finishRun(deps.db, {
      runId: run.id,
      status: 'failed',
      counts,
      finishedAt: now(),
    });
    // Checkpoint intentionally NOT advanced — the window did not fully succeed.
    return { run: finished, status: 'failed', newLotIds: [], failureCode };
  }

  // ADR-0009 §1: once, at window end (never per-skip — there is no abort),
  // a significant share of render-pending skips gets ONE durable alert row.
  // This is a signal, NOT a window failure — status/checkpoint below are
  // unaffected by it either way.
  if (isRenderPendingDegraded(counts.noticesRenderPending, counts.noticesSeen)) {
    await recordRenderPendingDegraded(deps, run.id, window, counts);
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
  return { run: finished, status, newLotIds, failureCode: null };
}

/**
 * Fetches, snapshots, parses, and persists ONE notice. Parse failures
 * (`TedParseError`) and XML fetch failures (`TedXmlTooLargeError`,
 * `TedRequestError` — ADR-0008 §1) are caught here and routed to
 * `ingestion_errors` — they never abort the window. `TedBudgetExceededError`
 * is NOT a `TedRequestError` and always propagates (ADR-0008 §4), as does
 * anything else (persistence errors, `FetchFailureThresholdError` from a
 * §2 threshold breach), to `runIngestionWindow`'s window-level failure
 * handling. Exported so the ADR-0008 §3/A2 drain reuses the IDENTICAL
 * fetch/snapshot/parse/persist path for retried notices.
 *
 * `opts.swallowFetchErrors` (default `true`, the window's §1 behavior):
 * when `false` — used ONLY by the drain — a `TedRequestError` is NOT
 * absorbed into a record-and-continue skip; it propagates instead, so the
 * drain's own per-cycle bookkeeping (`recordFetchRetryFailure` /
 * `markFetchRetryAbandoned`, ADR-0008 §3's "Failure -> attempts += 1")
 * decides the outcome instead of §1's window-level skip+upsert+threshold
 * machinery, which does not apply to windowless drain rows (Amendment §A2:
 * "Drain outcomes never feed the §2 threshold").
 */
export async function processOneNotice(
  deps: RunWindowDeps,
  ingestionRunId: string,
  row: SearchRowFields,
  counts: MutableCounts,
  newLotIds: string[],
  now: () => number,
  opts: { readonly swallowFetchErrors?: boolean } = {},
): Promise<void> {
  const swallowFetchErrors = opts.swallowFetchErrors ?? true;
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
    if (cause instanceof TedXmlTooLargeError) {
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
    if (cause instanceof TedRequestError && swallowFetchErrors) {
      // ADR-0008 §1: record-and-continue. `TedBudgetExceededError` is a
      // sibling type, NOT a TedRequestError, so it falls through to the
      // `throw cause` below and stays window-fatal (§4).
      const prefix = 'NOTICE_FETCH';
      const errorCode =
        cause.status === null
          ? `${prefix}_NETWORK_ERROR`
          : `${prefix}_HTTP_${String(cause.status)}`;
      await recordFetchSkip(
        deps,
        ingestionRunId,
        row,
        counts,
        errorCode,
        cause.message,
        { url: truncateForDiagnostic(cause.url), status: cause.status, attempts: cause.attempts },
        now,
      );
      return;
    }
    throw cause;
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
 * Shared plumbing for BOTH record-and-continue skip paths (ADR-0009 §1): a
 * durable `ingestion_errors` row, an idempotent `ingestion_fetch_retries`
 * upsert (due immediately — `next_attempt_at = now()` — so the SAME run's
 * drain, if any, can pick it up per ADR-0008 Amendment §A2), and a structured
 * warn log. No skipped notice ever loses its retry row, regardless of which
 * counter (`noticesFetchFailed` vs `noticesRenderPending`) the caller bumps.
 */
async function writeSkipDiagnostic(
  deps: RunWindowDeps,
  ingestionRunId: string,
  row: { sourceNoticeId: string; xmlUrl: string; publicationDate: string },
  errorCode: string,
  message: string,
  detail: Readonly<Record<string, unknown>>,
  now: () => number,
): Promise<void> {
  await recordError(deps.db, {
    ingestionRunId,
    source: TED_SOURCE_ID,
    sourceNoticeId: row.sourceNoticeId,
    stage: 'fetch',
    errorCode,
    message: truncateForDiagnostic(message),
    detail,
  });
  await upsertFetchRetry(deps.db, {
    source: TED_SOURCE_ID,
    sourceNoticeId: row.sourceNoticeId,
    xmlUrl: row.xmlUrl,
    publicationDate: row.publicationDate,
    errorCode,
    nextAttemptAt: now(),
    now: now(),
  });
  deps.logger.warn('ingestion.notice_fetch.skipped', {
    source_notice_id: row.sourceNoticeId,
    error_code: errorCode,
    attempts: detail['attempts'] ?? null,
  });
}

/**
 * Records one GENUINE fetch-failure skip (`NOTICE_FETCH_HTTP_*` /
 * `NOTICE_FETCH_NETWORK_ERROR` — origin refusing/failing us): bumps
 * `errorsCount`/`noticesFetchFailed`, writes the shared diagnostic, then
 * evaluates the §2 threshold. Throws `FetchFailureThresholdError` when the
 * threshold trips; callers let that propagate unchanged to
 * `runIngestionWindow`'s window-level catch.
 */
async function recordFetchSkip(
  deps: RunWindowDeps,
  ingestionRunId: string,
  row: { sourceNoticeId: string; xmlUrl: string; publicationDate: string },
  counts: MutableCounts,
  errorCode: string,
  message: string,
  detail: Readonly<Record<string, unknown>>,
  now: () => number,
): Promise<void> {
  counts.errorsCount += 1;
  counts.noticesFetchFailed += 1;
  await writeSkipDiagnostic(deps, ingestionRunId, row, errorCode, message, detail, now);
  if (isFetchFailureThresholdExceeded(counts.noticesFetchFailed, counts.noticesSeen)) {
    throw new FetchFailureThresholdError(counts.noticesFetchFailed, counts.noticesSeen);
  }
}

/**
 * Records one render-pending-exhaustion skip (ADR-0009 §1): bumps
 * `errorsCount`/`noticesRenderPending` and writes the shared diagnostic.
 * NEVER evaluates the §2 threshold — the origin is cooperating (202,
 * render just slow), not refusing us, so this path has no fail ceiling.
 * The distinct `RENDER_PENDING_DEGRADED` signal is evaluated once, at
 * window end, by `maybeRecordRenderPendingDegraded` below.
 */
async function recordRenderPendingSkip(
  deps: RunWindowDeps,
  ingestionRunId: string,
  row: { sourceNoticeId: string; xmlUrl: string; publicationDate: string },
  counts: MutableCounts,
  message: string,
  detail: Readonly<Record<string, unknown>>,
  now: () => number,
): Promise<void> {
  counts.errorsCount += 1;
  counts.noticesRenderPending += 1;
  await writeSkipDiagnostic(
    deps,
    ingestionRunId,
    row,
    'NOTICE_RENDER_PENDING',
    message,
    detail,
    now,
  );
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
  if (cause instanceof FetchFailureThresholdError) {
    // ADR-0008 §2: record-and-continue is bounded — this many failures looks
    // systemic rather than notice-specific, so the window aborts.
    const ratio = cause.noticesSeen > 0 ? cause.noticesFetchFailed / cause.noticesSeen : 0;
    return {
      stage: 'fetch',
      errorCode: 'FETCH_FAILURE_THRESHOLD_EXCEEDED',
      message: cause.message,
      detail: {
        noticesFetchFailed: cause.noticesFetchFailed,
        noticesSeen: cause.noticesSeen,
        ratio,
        min: FETCH_FAILURE_FAIL_MIN,
        maxRatio: FETCH_FAILURE_FAIL_RATIO,
      },
    };
  }
  if (cause instanceof TedRenderPendingError) {
    return {
      stage: 'fetch',
      errorCode: 'NOTICE_RENDER_PENDING',
      message: truncateForDiagnostic(cause.message),
      detail: { url: truncateForDiagnostic(cause.url), status: cause.status },
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
 * Returns the classified error code (ADR-0009 §2's `RunWindowResult.failureCode`)
 * regardless of whether the diagnostic write itself succeeded.
 */
async function recordWindowFailure(
  deps: RunWindowDeps,
  ingestionRunId: string,
  currentNotice: { sourceNoticeId: string; xmlUrl: string } | null,
  window: PublicationWindow,
  cause: unknown,
  counts: MutableCounts,
): Promise<string> {
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
  return diag.errorCode;
}

/**
 * ADR-0009 §1: writes the ONE durable `RENDER_PENDING_DEGRADED` diagnostic
 * row + structured error log when render-pending skips are significant for
 * this window (`isRenderPendingDegraded`). This is an alert, not a failure —
 * called from the SUCCESS path only, never the window-failure catch, and
 * never throws (a failure to write it must not turn a healthy-otherwise
 * `partial` window into a hard failure — logged and swallowed, same
 * guardedness as `recordWindowFailure`'s own diagnostic write).
 */
async function recordRenderPendingDegraded(
  deps: RunWindowDeps,
  ingestionRunId: string,
  window: PublicationWindow,
  counts: MutableCounts,
): Promise<void> {
  const ratio = counts.noticesSeen > 0 ? counts.noticesRenderPending / counts.noticesSeen : 0;
  const detail = {
    noticesRenderPending: counts.noticesRenderPending,
    noticesSeen: counts.noticesSeen,
    ratio,
    min: RENDER_PENDING_DEGRADED_MIN,
    minRatio: RENDER_PENDING_DEGRADED_RATIO,
  };
  deps.logger.error('ingestion.window.render_pending_degraded', {
    source: TED_SOURCE_ID,
    window_from: window.windowFrom,
    window_to: window.windowTo,
    ...detail,
  });
  try {
    await recordError(deps.db, {
      ingestionRunId,
      source: TED_SOURCE_ID,
      stage: 'fetch',
      errorCode: 'RENDER_PENDING_DEGRADED',
      message:
        `render-pending skips (${String(counts.noticesRenderPending)}/` +
        `${String(counts.noticesSeen)}) exceeded the degraded-render alert threshold`,
      detail: { ...detail, windowFrom: window.windowFrom, windowTo: window.windowTo },
    });
    counts.errorsCount += 1;
  } catch (recordCause) {
    deps.logger.error('ingestion.window.render_pending_degraded.diagnostic_write_failed', {
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
