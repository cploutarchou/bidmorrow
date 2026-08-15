/**
 * Pure digest rendering — docs/product-scope.md §7. No DB/network access:
 * takes already-loaded items and produces subject/html/text. Every
 * source-derived value (title, buyer name) is escaped via `escapeHtml`
 * before touching the HTML template (docs/security.md C2) — procurement
 * titles/buyers are hostile input (an org could receive a match whose title
 * contains a `<script>` tag lifted verbatim from a TED notice).
 */
import { escapeHtml } from './escape-html';

export type DigestClassification =
  'STRONG_MATCH' | 'WORTH_REVIEWING' | 'POSSIBLE_MATCH' | 'LOW_FIT';

export type DigestRiskConfidence = 'HIGH' | 'POSSIBLE';

export interface DigestRenderItem {
  /** Null when the underlying match was purged, or on a degraded resume render — omit the CTA link (P8-R-03). */
  readonly matchId: string | null;
  readonly title: string;
  readonly score: number | null;
  readonly classification: DigestClassification;
  /** Top 2 score-component explanations, highest points first. */
  readonly reasons: readonly string[];
  readonly topRisk: {
    readonly explanation: string;
    readonly confidence: DigestRiskConfidence;
  } | null;
  readonly buyerName: string | null;
  /** Epoch millis; null when the lot carries no deadline. */
  readonly deadlineAt: number | null;
}

export interface DigestCounts {
  readonly STRONG_MATCH: number;
  readonly WORTH_REVIEWING: number;
  readonly POSSIBLE_MATCH: number;
  readonly LOW_FIT: number;
}

export interface RenderDigestArgs {
  /** Already sorted score DESC; only the first 10 are rendered. */
  readonly items: readonly DigestRenderItem[];
  readonly counts: DigestCounts;
  readonly orgName: string;
  /** `YYYY-MM-DD`, the org-local digest date. */
  readonly digestDate: string;
  /** e.g. `https://app.bidmorrow.com` — CTA links are `${appBaseUrl}/app/tenders/{matchId}`. */
  readonly appBaseUrl: string;
  /** e.g. `https://app.bidmorrow.com/app/settings` — manage-preferences link. */
  readonly manageUrl: string;
}

export interface RenderedDigest {
  readonly subject: string;
  readonly html: string;
  readonly text: string;
}

export const DIGEST_MAX_ITEMS = 10;

const CLASSIFICATION_LABEL: Record<DigestClassification, string> = {
  STRONG_MATCH: 'Strong match',
  WORTH_REVIEWING: 'Worth reviewing',
  POSSIBLE_MATCH: 'Possible match',
  LOW_FIT: 'Low fit',
};

/** Mirrors apps/web/src/lib/format.ts `riskConfidenceLabel` — POSSIBLE always carries the verify wording. */
const RISK_CONFIDENCE_LABEL: Record<DigestRiskConfidence, string> = {
  HIGH: 'Confirmed pattern',
  POSSIBLE: 'Possible requirement — verify in source documents',
};

function formatDeadline(deadlineAt: number | null): string {
  if (deadlineAt === null) return 'No stated deadline';
  return new Date(deadlineAt).toISOString().slice(0, 10);
}

function formatScore(item: DigestRenderItem): string {
  const score = item.score === null ? 'n/a' : Math.round(item.score).toString();
  return `${score} — ${CLASSIFICATION_LABEL[item.classification]}`;
}

/**
 * Renders one digest to subject + HTML + plain-text alternative. Pure: same
 * inputs always produce the same output (the resume path relies on this —
 * re-rendering from stored `digest_items` snapshots on a queue retry never
 * changes what was already attempted).
 */
export function renderDigest(args: RenderDigestArgs): RenderedDigest {
  const items = args.items.slice(0, DIGEST_MAX_ITEMS);
  const totalCount =
    args.counts.STRONG_MATCH +
    args.counts.WORTH_REVIEWING +
    args.counts.POSSIBLE_MATCH +
    args.counts.LOW_FIT;

  const subject =
    totalCount === 0
      ? `BidMorrow daily digest — no new matches (${args.digestDate})`
      : `BidMorrow daily digest — ${totalCount} new match${totalCount === 1 ? '' : 'es'} (${args.digestDate})`;

  const countsLine =
    `Strong: ${args.counts.STRONG_MATCH} · Worth reviewing: ${args.counts.WORTH_REVIEWING} · ` +
    `Possible: ${args.counts.POSSIBLE_MATCH} · Low fit: ${args.counts.LOW_FIT}`;

  const htmlItems = items
    .map((item) => {
      // CTA link only when matchId is known (P8-R-03) — a purged match or a
      // degraded resume render has no valid /app/tenders/{matchId} target,
      // so the title renders as plain (escaped) text instead of a link.
      const titleHtml =
        item.matchId === null
          ? escapeHtml(item.title)
          : `<a href="${escapeHtml(`${args.appBaseUrl}/app/tenders/${encodeURIComponent(item.matchId)}`)}">${escapeHtml(item.title)}</a>`;
      const reasons = item.reasons.map((reason) => `<li>${escapeHtml(reason)}</li>`).join('');
      const risk =
        item.topRisk === null
          ? ''
          : `<p>Risk: ${escapeHtml(item.topRisk.explanation)} (${escapeHtml(
              RISK_CONFIDENCE_LABEL[item.topRisk.confidence],
            )})</p>`;
      return `
        <article>
          <h2>${titleHtml}</h2>
          <p>${escapeHtml(formatScore(item))}</p>
          <ul>${reasons}</ul>
          ${risk}
          <p>Buyer: ${escapeHtml(item.buyerName ?? 'Unknown')}</p>
          <p>Deadline: ${escapeHtml(formatDeadline(item.deadlineAt))}</p>
        </article>`;
    })
    .join('\n');

  const bodyHtml =
    items.length === 0
      ? '<p>No new matches met your digest threshold today.</p>'
      : `<p>${escapeHtml(countsLine)}</p>${htmlItems}`;

  const html = `<!DOCTYPE html>
<html lang="en">
<head><meta charset="utf-8"><title>${escapeHtml(subject)}</title></head>
<body>
  <h1>${escapeHtml(`Daily digest for ${args.orgName}`)}</h1>
  ${bodyHtml}
  <hr>
  <footer>
    <p>Source: Tenders Electronic Daily (TED), the EU's public procurement portal
    (Decision 2011/833/EU on the reuse of Commission documents).</p>
    <p>Scores and flags are decision support, not legal or procurement advice —
    always verify against the original notice before bidding.</p>
    <p><a href="${escapeHtml(args.manageUrl)}">Manage digest preferences</a></p>
    <p>You are receiving this because your organization enabled the daily digest.
    You can turn it off any time from digest preferences.</p>
  </footer>
</body>
</html>`;

  const textItems = items
    .map((item) => {
      // CTA link only when matchId is known — see the HTML branch above (P8-R-03).
      const urlLine =
        item.matchId === null
          ? ''
          : `${args.appBaseUrl}/app/tenders/${encodeURIComponent(item.matchId)}\n`;
      const reasons = item.reasons.map((reason) => `  - ${reason}`).join('\n');
      const risk =
        item.topRisk === null
          ? ''
          : `\nRisk: ${item.topRisk.explanation} (${RISK_CONFIDENCE_LABEL[item.topRisk.confidence]})`;
      return (
        `\n${item.title}\n${formatScore(item)}\n${reasons}${risk}\n` +
        `Buyer: ${item.buyerName ?? 'Unknown'}\nDeadline: ${formatDeadline(item.deadlineAt)}\n${urlLine}`
      );
    })
    .join('\n');

  const bodyText =
    items.length === 0 ? 'No new matches met your digest threshold today.\n' : textItems;

  const text =
    `Daily digest for ${args.orgName}\n\n${countsLine}\n${bodyText}\n` +
    `---\n` +
    `Source: Tenders Electronic Daily (TED), the EU's public procurement portal ` +
    `(Decision 2011/833/EU on the reuse of Commission documents).\n` +
    `Scores and flags are decision support, not legal or procurement advice — ` +
    `always verify against the original notice before bidding.\n` +
    `Manage digest preferences: ${args.manageUrl}\n` +
    `You are receiving this because your organization enabled the daily digest. ` +
    `You can turn it off any time from digest preferences.\n`;

  return { subject, html, text };
}
