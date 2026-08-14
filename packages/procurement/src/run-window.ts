/**
 * Ingestion orchestration: composes `@bidmorrow/ted` (client + parser) with
 * `@bidmorrow/db` (checkpointed, idempotent persistence) into one bounded
 * publication-date-window run (ted-ingestion-audit checklist items 1–7).
 */
import { TED_SOURCE_ID, TedParseError } from '@bidmorrow/ted';
import type { TedClient } from '@bidmorrow/ted';
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
}

interface MutableCounts {
  noticesSeen: number;
  noticesUpserted: number;
  versionsCreated: number;
  lotsCreated: number;
  /** Scoring runs inside the ingestion pipeline in a later phase; always 0 here. */
  matchesScored: number;
  errorsCount: number;
}

/**
 * Runs ingestion for exactly one publication-date window. Never throws on a
 * single bad notice (routed to `ingestion_errors`, status becomes
 * `partial`); DOES throw-and-fail-the-run on window-level failures (request
 * budget exhausted, an HTTP failure surviving the client's own retries, or
 * any unexpected persistence error) — the checkpoint is only advanced when
 * the window finishes non-`failed`.
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

  try {
    const query = buildScopeQuery(deps.scope, window);
    for await (const page of deps.client.iterateSearch({
      query,
      fields: SEARCH_FIELDS,
      limit: SEARCH_PAGE_LIMIT,
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
        await processOneNotice(deps, run.id, extracted, counts);
      }
    }
  } catch (cause) {
    deps.logger.error('ingestion.window.failed', {
      source: TED_SOURCE_ID,
      window_from: window.windowFrom,
      window_to: window.windowTo,
      error: cause instanceof Error ? cause.message : String(cause),
    });
    const finished = await finishRun(deps.db, {
      runId: run.id,
      status: 'failed',
      counts,
      finishedAt: now(),
    });
    // Checkpoint intentionally NOT advanced — the window did not fully succeed.
    return { run: finished, status: 'failed' };
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
  return { run: finished, status };
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
): Promise<void> {
  const existingNotice = await getNoticeByPublicationNumber(deps.db, {
    source: TED_SOURCE_ID,
    publicationNumber: row.sourceNoticeId,
  });
  const prospectiveVersion =
    existingNotice === null ? 1 : (await getLatestVersionNumber(deps.db, existingNotice.id)) + 1;

  const rawXml = await deps.client.fetchNoticeXml(row.xmlUrl);
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
      detail: { issues: cause.issues },
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
