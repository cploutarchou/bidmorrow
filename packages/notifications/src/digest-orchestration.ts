/**
 * Digest scheduling + generation (Phase 8, docs/product-scope.md §7).
 * `@bidmorrow/notifications` owns the digest end-to-end: selecting which
 * orgs are due, claiming/resuming their `digest_runs` row, collecting
 * candidate matches, rendering, and sending. Depends on domain + db +
 * observability only (no `@bidmorrow/matching`/`@bidmorrow/procurement`) —
 * `engineVersion` is threaded in from the composition root
 * (`apps/worker`, the only place `@bidmorrow/matching`'s `ENGINE_VERSION`
 * is imported for this purpose).
 *
 * TIMEZONE / SEND-HOUR MODEL: the Worker cron fires hourly (documented in
 * apps/worker/wrangler.jsonc — timezones roll over at different UTC hours,
 * so a once-daily UTC cron cannot serve every org at a consistent LOCAL
 * time). `selectDigestOrgs` computes each org's current LOCAL date and hour
 * via `Intl.DateTimeFormat` with its `timezone` preference, and considers
 * an org due when its local hour is at/after `DEFAULT_SEND_HOUR_LOCAL`
 * (06:00) AND no `digest_runs` row exists yet for that local date. Because
 * "due" is re-evaluated every hour and gated by the DB-enforced
 * `(organization_id, digest_date)` uniqueness (never "has the exact send
 * hour passed", which a missed cron invocation could skip past forever),
 * a transient cron/queue failure self-heals on the next hourly check
 * instead of silently skipping a day.
 */
import type { OrganizationId } from '@bidmorrow/domain';
import type { Db } from '@bidmorrow/db';
import {
  DuplicateDigestError,
  createDigestRun,
  createEmailDelivery,
  getDigestPreferences,
  getDigestRunByDate,
  getFeatureFlag,
  getOrganization,
  insertDigestItems,
  listDigestCandidateMatches,
  listDigestItems,
  listOrgsWithDigestEnabled,
  listOrganizationMemberEmails,
  recordDigestRunOutcome,
  updateEmailDeliveryStatus,
} from '@bidmorrow/db';
import type { DigestCandidateMatch, DigestItem, DigestRun } from '@bidmorrow/db';
import type { Logger } from '@bidmorrow/observability';

import { renderDigest } from './digest-renderer';
import type { DigestClassification, DigestCounts, DigestRenderItem } from './digest-renderer';
import { PermanentEmailError, RetryableEmailError } from './resend';
import type { DigestEmailProvider } from './resend';

const FLAG_DIGEST_PAUSED = 'digest_paused' as const;
/** Send-hour cutoff, in the org's local time — documented above. */
export const DEFAULT_SEND_HOUR_LOCAL = 6;
/** Bounded candidate collection per run — see listDigestCandidateMatches doc. */
export const MAX_DIGEST_ITEMS = 200;
/** Fallback lookback when the org has no prior digest run to anchor the window. */
const FALLBACK_WINDOW_MS = 24 * 60 * 60 * 1000;

/**
 * Reads the `digest_paused` global flag; absent/malformed defaults to NOT
 * paused (same availability-over-strictness rationale as
 * `packages/procurement/src/scope.ts`'s `isIngestionPaused` — an emergency
 * stop lever must never itself become an outage via a malformed value).
 */
export async function isDigestPaused(db: Db, logger?: Logger): Promise<boolean> {
  const flag = await getFeatureFlag(db, FLAG_DIGEST_PAUSED);
  if (flag === null) return false;
  try {
    return JSON.parse(flag.valueJson) === true;
  } catch (cause) {
    logger?.warn('digest.paused_flag.malformed', {
      value_json: flag.valueJson,
      error: cause instanceof Error ? cause.message : String(cause),
    });
    return false;
  }
}

/** `YYYY-MM-DD` local calendar date + local hour (0-23) for an IANA timezone at a given instant. */
export function localDateAndHour(
  utcNow: number,
  timezone: string,
): { localDate: string; localHour: number } {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: timezone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    hour12: false,
  }).formatToParts(new Date(utcNow));
  const get = (type: string): string => parts.find((p) => p.type === type)?.value ?? '';
  const year = get('year');
  const month = get('month');
  const day = get('day');
  // en-CA's hour part can render midnight as "24" in some engines; normalize.
  const hourRaw = Number.parseInt(get('hour'), 10);
  const localHour = hourRaw === 24 ? 0 : hourRaw;
  return { localDate: `${year}-${month}-${day}`, localHour };
}

export interface DueDigestOrg {
  readonly organizationId: OrganizationId;
  readonly localDate: string;
}

/**
 * Orgs due for a digest right now: digest enabled, local hour ≥
 * `DEFAULT_SEND_HOUR_LOCAL`, and no `digest_runs` row for their current
 * local date yet. One small per-org existence check — V1 customer counts
 * are small (docs/cost-model.md), matching the unpaginated-scan pattern
 * used elsewhere (`listOrgsEligibleForScoring`).
 */
export async function selectDigestOrgs(db: Db, args: { utcNow: number }): Promise<DueDigestOrg[]> {
  const candidates = await listOrgsWithDigestEnabled(db);
  const due: DueDigestOrg[] = [];
  for (const org of candidates) {
    const { localDate, localHour } = localDateAndHour(args.utcNow, org.timezone);
    if (localHour < DEFAULT_SEND_HOUR_LOCAL) continue;
    const existing = await getDigestRunByDate(db, org.organizationId, localDate);
    if (existing !== null) continue;
    due.push({ organizationId: org.organizationId, localDate });
  }
  return due;
}

const CLASSIFICATION_RANK: Record<DigestClassification, number> = {
  STRONG_MATCH: 4,
  WORTH_REVIEWING: 3,
  POSSIBLE_MATCH: 2,
  LOW_FIT: 1,
};

function isDigestClassification(value: string): value is DigestClassification {
  return value in CLASSIFICATION_RANK;
}

function countsFromItems(items: readonly { classificationSnapshot: string }[]): DigestCounts {
  const counts: Record<DigestClassification, number> = {
    STRONG_MATCH: 0,
    WORTH_REVIEWING: 0,
    POSSIBLE_MATCH: 0,
    LOW_FIT: 0,
  };
  for (const item of items) {
    if (isDigestClassification(item.classificationSnapshot)) {
      counts[item.classificationSnapshot] += 1;
    }
  }
  return counts;
}

/**
 * FRESH PATH (P8-R-01): renders directly from the just-collected
 * `DigestCandidateMatch` rows returned by `listDigestCandidateMatches` —
 * `digest_items` has no columns for reasons/topRisk/buyerName/deadlineAt
 * (`packages/db/src/schema/engagement.ts` only persists
 * title/score/classification snapshots), so the normal send path never goes
 * through the DB round-trip for these fields; it uses the same in-memory
 * data that produced the `digest_items` rows in the same invocation. This
 * is the path every non-resumed digest takes, so digest emails contain
 * reasons/top risk/buyer/deadline on the normal (non-degraded) path.
 */
function toRenderItemsFromCandidates(
  candidates: readonly DigestCandidateMatch[],
): DigestRenderItem[] {
  return candidates
    .filter((candidate) => isDigestClassification(candidate.classification))
    .map((candidate) => ({
      matchId: candidate.matchId,
      title: candidate.title,
      score: candidate.score,
      classification: candidate.classification as DigestClassification,
      reasons: candidate.topReasons,
      topRisk:
        candidate.topRiskFlag === null
          ? null
          : {
              explanation: candidate.topRiskFlag.explanation,
              confidence: candidate.topRiskFlag.confidence,
            },
      buyerName: candidate.buyerName,
      deadlineAt: candidate.deadlineAt,
    }));
}

/**
 * RESUME PATH: `digest_items` only persists title/score/classification
 * snapshots (no reasons/risk/buyer/deadline columns exist — see the fresh
 * path's doc above), so a resumed render cannot reconstruct those fields
 * without re-querying and risking a body that no longer matches what was
 * originally counted/ranked. Rather than silently omitting the detail (the
 * masking gap the review flagged), each resumed item's `reasons` carries an
 * explicit degraded-render note so the recipient sees why detail is
 * missing, instead of a normal-looking but silently thinner email.
 * Documented trade-off, unchanged in substance from the original: a resumed
 * render guarantees no duplicate items and a stable subject/count, not a
 * byte-identical body to the first attempt — now made honest in the
 * rendered copy itself rather than only in code comments.
 */
const RESUME_DEGRADED_NOTE = '(details unavailable — resent digest)';

function toRenderItemsFromSnapshot(items: readonly DigestItem[]): DigestRenderItem[] {
  return items
    .filter((item) => isDigestClassification(item.classificationSnapshot))
    .map((item) => ({
      matchId: item.matchId,
      title: item.titleSnapshot,
      score: item.scoreSnapshot,
      classification: item.classificationSnapshot as DigestClassification,
      reasons: [RESUME_DEGRADED_NOTE],
      topRisk: null,
      buyerName: null,
      deadlineAt: null,
    }));
}

export type DigestOutcomeStatus = 'sent' | 'skipped_empty' | 'skipped_paused' | 'failed';

export interface DigestOutcome {
  readonly status: DigestOutcomeStatus;
  readonly resumed: boolean;
  readonly matchesCount: number;
}

export interface GenerateDigestDeps {
  readonly db: Db;
  readonly logger: Logger;
  readonly provider: DigestEmailProvider;
  /** e.g. `https://app.bidmorrow.com`. */
  readonly appBaseUrl: string;
  /** Threaded in from the composition root — see module doc. */
  readonly engineVersion: string;
}

/**
 * Generates (or resumes) one organization's digest for `localDate`.
 *
 * RESUME PATH: `createDigestRun` DB-enforces one row per (org, date). A
 * queue retry after a `RetryableEmailError` throw hits `DuplicateDigestError`
 * on its second attempt — this function then reads the existing row: a
 * terminal status (`sent`/`skipped_empty`/`skipped_paused`) means another
 * invocation already finished it (no-op, returns that status); `pending`/
 * `failed` means THIS invocation's own prior attempt was interrupted before
 * (or after) a send failure — it resumes by loading the already-written
 * `digest_items` (never re-collecting candidates, so a retry can never
 * duplicate/renumber items) and re-rendering + re-sending from them.
 */
export async function generateDigest(
  deps: GenerateDigestDeps,
  organizationId: OrganizationId,
  args: { localDate: string; utcNow: number },
): Promise<DigestOutcome> {
  const { db, logger, provider, appBaseUrl, engineVersion } = deps;

  if (await isDigestPaused(db, logger)) {
    logger.info('digest.skipped.paused_global', { organization_id: organizationId });
    return { status: 'skipped_paused', resumed: false, matchesCount: 0 };
  }

  const prefs = await getDigestPreferences(db, organizationId);
  if (prefs === null || prefs.enabled !== 1) {
    logger.info('digest.skipped.disabled', { organization_id: organizationId });
    return { status: 'skipped_paused', resumed: false, matchesCount: 0 };
  }

  let run: DigestRun;
  let resumed = false;
  try {
    run = await createDigestRun(db, organizationId, { digestDate: args.localDate });
  } catch (cause) {
    if (!(cause instanceof DuplicateDigestError)) throw cause;
    const existing = await getDigestRunByDate(db, organizationId, args.localDate);
    if (existing === null) throw cause; // lost the race to a row that then vanished — surface, never silent
    if (existing.status !== 'pending' && existing.status !== 'failed') {
      logger.info('digest.skipped.duplicate', {
        organization_id: organizationId,
        status: existing.status,
      });
      return {
        status: existing.status as DigestOutcomeStatus,
        resumed: false,
        matchesCount: existing.matchesCount,
      };
    }
    run = existing;
    resumed = true;
  }

  let itemRows: DigestItem[];
  let renderItems: DigestRenderItem[];
  if (resumed) {
    itemRows = await listDigestItems(db, organizationId, { digestRunId: run.id });
    renderItems = toRenderItemsFromSnapshot(itemRows);
  } else {
    const sinceMs = args.utcNow - FALLBACK_WINDOW_MS;
    const candidates = await listDigestCandidateMatches(db, organizationId, {
      engineVersion,
      minClassification: prefs.minClassification as DigestClassification,
      sinceMs,
      untilMs: args.utcNow,
      now: args.utcNow,
      limit: MAX_DIGEST_ITEMS,
    });
    if (candidates.length > 0) {
      itemRows = await insertDigestItems(db, organizationId, {
        digestRunId: run.id,
        items: candidates.map((candidate, index) => ({
          matchId: candidate.matchId,
          rank: index + 1,
          titleSnapshot: candidate.title,
          scoreSnapshot: candidate.score,
          classificationSnapshot: candidate.classification,
        })),
      });
      // Rendered straight from the just-collected candidates, not from the
      // rows just written — same data, no extra round-trip, and this is
      // what makes reasons/top risk/buyer/deadline present on the normal
      // send path (P8-R-01).
      renderItems = toRenderItemsFromCandidates(candidates);
    } else {
      itemRows = [];
      renderItems = [];
    }
  }

  if (itemRows.length === 0 && prefs.sendEmpty !== 1) {
    await recordDigestRunOutcome(db, organizationId, {
      digestRunId: run.id,
      status: 'skipped_empty',
      matchesCount: 0,
    });
    logger.info('digest.skipped.empty', { organization_id: organizationId });
    return { status: 'skipped_empty', resumed, matchesCount: 0 };
  }

  const organization = await getOrganization(db, organizationId);
  const recipients = await listOrganizationMemberEmails(db, organizationId);
  if (organization === null || recipients.length === 0) {
    // No org row or nobody to send to — permanent, non-retryable data state.
    await recordDigestRunOutcome(db, organizationId, {
      digestRunId: run.id,
      status: 'failed',
      matchesCount: itemRows.length,
    });
    logger.error('digest.failed.no_recipients', {
      organization_id: organizationId,
      recipient_count: recipients.length,
    });
    return { status: 'failed', resumed, matchesCount: itemRows.length };
  }

  const rendered = renderDigest({
    items: renderItems,
    counts: countsFromItems(itemRows),
    orgName: organization.name,
    digestDate: args.localDate,
    appBaseUrl,
    manageUrl: `${appBaseUrl}/app/settings`,
  });

  // P8-R-02: email every org member, not just the first. One
  // `email_deliveries` row per recipient (the table's `to_email` column is
  // singular and its `(provider, provider_message_id)` uniqueness assumes
  // one row = one provider send = one recipient, so a "recipient_count on
  // one row" representation would collide with that constraint and would
  // also be unable to record a per-recipient provider message id or
  // per-recipient failure — the accurate representation given the existing
  // schema is one row per recipient). Sends are sequential and `await`ed on
  // the SAME provider instance, so `MIN_SEND_SPACING_MS` spacing applies
  // across every recipient (and, since SEC-P8-01, across every digest in
  // the same queue batch too — see apps/worker/src/index.ts).
  let firstDeliveryId: string | null = null;
  let firstSuccessfulDeliveryId: string | null = null;
  let sentCount = 0;
  let permanentFailureCount = 0;

  for (const toEmail of recipients) {
    const delivery = await createEmailDelivery(db, organizationId, {
      kind: 'digest',
      toEmail,
      provider: 'resend',
    });
    if (firstDeliveryId === null) firstDeliveryId = delivery.id;

    try {
      const sendResult = await provider.send({
        to: toEmail,
        kind: 'digest',
        subject: rendered.subject,
        html: rendered.html,
        text: rendered.text,
      });
      await updateEmailDeliveryStatus(db, organizationId, {
        emailDeliveryId: delivery.id,
        status: 'sent',
        providerMessageId: sendResult.providerMessageId,
      });
      sentCount += 1;
      if (firstSuccessfulDeliveryId === null) firstSuccessfulDeliveryId = delivery.id;
    } catch (cause) {
      const retryable = cause instanceof RetryableEmailError;
      const permanent = cause instanceof PermanentEmailError;
      const errorMessage = cause instanceof Error ? cause.message : 'unknown send error';
      await updateEmailDeliveryStatus(db, organizationId, {
        emailDeliveryId: delivery.id,
        status: 'failed',
        error: errorMessage,
      });
      logger.error('digest.send_failed', {
        organization_id: organizationId,
        retryable,
        error: errorMessage,
      });
      if (retryable || !permanent) {
        // Unknown/network-shaped errors default to retryable — never
        // silently drop a digest because of an unrecognized failure mode.
        // Aborts the remaining recipients; the queue retry re-sends to
        // every recipient again (the accepted at-least-once window —
        // SEC-P8-02), never re-collects candidates (SEC-P8-03/P8-R-02).
        await recordDigestRunOutcome(db, organizationId, {
          digestRunId: run.id,
          status: 'failed',
          matchesCount: itemRows.length,
          emailDeliveryId: firstDeliveryId,
        });
        throw cause;
      }
      permanentFailureCount += 1;
      // Permanent failure for THIS recipient only — keep sending to the rest.
    }
  }

  const overallStatus: DigestOutcomeStatus = sentCount > 0 ? 'sent' : 'failed';
  await recordDigestRunOutcome(db, organizationId, {
    digestRunId: run.id,
    status: overallStatus,
    matchesCount: itemRows.length,
    emailDeliveryId: firstSuccessfulDeliveryId ?? firstDeliveryId,
    ...(overallStatus === 'sent' ? { sentAt: Date.now() } : {}),
  });
  logger.info('digest.sent', {
    organization_id: organizationId,
    items: itemRows.length,
    recipient_count: recipients.length,
    sent_count: sentCount,
    permanent_failure_count: permanentFailureCount,
  });
  return { status: overallStatus, resumed, matchesCount: itemRows.length };
}
