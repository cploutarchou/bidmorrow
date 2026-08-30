/**
 * Pure digest rendering — docs/product-scope.md §7. No DB/network access:
 * takes already-loaded items and produces subject/html/text. Every
 * source-derived value (title, buyer name) is escaped via `escapeHtml`
 * before touching the HTML template (docs/security.md C2) — procurement
 * titles/buyers are hostile input (an org could receive a match whose title
 * contains a `<script>` tag lifted verbatim from a TED notice).
 */
import {
  NOTIFICATIONS_DECISION_SUPPORT_DISCLAIMER,
  NOTIFICATIONS_TED_ATTRIBUTION,
  SUPPORT_EMAIL,
} from './copy';
import { EMAIL_BRAND, emailButton, emailLink, renderEmailLayout } from './email-layout';
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
  /**
   * Absolute, per-recipient no-login unsubscribe URL (F-08). `null` ONLY on
   * the preview path, which renders a digest for an operator with no
   * recipient and therefore no token to sign — a real send always passes
   * one, and the unsubscribe block is omitted rather than faked when it is
   * absent. The same URL is set in `List-Unsubscribe`.
   */
  readonly unsubscribeUrl: string | null;
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

  // "N matches today" — a short scannable summary above the per-classification
  // breakdown (`countsLine`), which stays verbatim below since tests assert
  // its exact "Strong: N · Worth reviewing: N · …" shape.
  const summaryLabel = totalCount === 1 ? '1 match today' : `${totalCount} matches today`;

  const htmlItems = items
    .map((item) => {
      // CTA link only when matchId is known (P8-R-03) — a purged match or a
      // degraded resume render has no valid /app/tenders/{matchId} target,
      // so the title renders as plain (escaped) text instead of a link.
      const titleHtml =
        item.matchId === null
          ? escapeHtml(item.title)
          : `<a href="${escapeHtml(`${args.appBaseUrl}/app/tenders/${encodeURIComponent(item.matchId)}`)}" style="color:${EMAIL_BRAND.accent};text-decoration:none;">${escapeHtml(item.title)}</a>`;
      const reasons = item.reasons.map((reason) => `<li>${escapeHtml(reason)}</li>`).join('');
      const risk =
        item.topRisk === null
          ? ''
          : `<p style="margin:0 0 8px;">Risk: ${escapeHtml(item.topRisk.explanation)} (${escapeHtml(
              RISK_CONFIDENCE_LABEL[item.topRisk.confidence],
            )})</p>`;
      return `
        <div style="border:1px solid ${EMAIL_BRAND.border};border-radius:8px;padding:16px 20px;margin:0 0 16px;">
          <h2 style="margin:0 0 8px;font-size:16px;line-height:1.4;">${titleHtml}</h2>
          <p style="margin:0 0 8px;">
            <span style="display:inline-block;background:${EMAIL_BRAND.background};color:${EMAIL_BRAND.ink};border-radius:999px;padding:2px 10px;font-size:13px;font-weight:600;">${escapeHtml(formatScore(item))}</span>
          </p>
          <ul style="margin:0 0 8px;padding-left:20px;color:${EMAIL_BRAND.ink};">${reasons}</ul>
          ${risk}
          <p style="margin:0 0 4px;color:${EMAIL_BRAND.muted};">Buyer: ${escapeHtml(item.buyerName ?? 'Unknown')}</p>
          <p style="margin:0;color:${EMAIL_BRAND.muted};">Deadline: ${escapeHtml(formatDeadline(item.deadlineAt))}</p>
        </div>`;
    })
    .join('\n');

  const emptyStateHtml =
    items.length === 0 ? '<p>No new matches met your digest threshold today.</p>' : '';

  const ctaHtml = `<p style="margin:24px 0 0;">${emailButton(`${args.appBaseUrl}/app`, 'View in BidMorrow')}</p>`;

  const bodyHtml =
    `<h1 style="margin:0 0 4px;font-size:20px;color:${EMAIL_BRAND.ink};">${escapeHtml(`Daily digest for ${args.orgName}`)}</h1>` +
    `<p style="margin:0 0 16px;color:${EMAIL_BRAND.muted};">${escapeHtml(args.digestDate)}</p>` +
    (totalCount > 0
      ? `<p style="margin:0 0 4px;font-weight:600;">${escapeHtml(summaryLabel)}</p>`
      : '') +
    `<p style="margin:0 0 20px;color:${EMAIL_BRAND.muted};">${escapeHtml(countsLine)}</p>` +
    emptyStateHtml +
    htmlItems +
    ctaHtml;

  const footerHtml =
    `<p style="margin:0 0 8px;">${escapeHtml(NOTIFICATIONS_TED_ATTRIBUTION)}</p>` +
    `<p style="margin:0 0 8px;">${escapeHtml(NOTIFICATIONS_DECISION_SUPPORT_DISCLAIMER)}</p>` +
    `<p style="margin:0 0 8px;">${emailLink(args.manageUrl, 'Manage digest preferences')}</p>` +
    `<p style="margin:0 0 8px;">You are receiving this because your organization enabled the daily digest. ` +
    `You can turn it off any time from digest preferences.</p>` +
    (args.unsubscribeUrl === null
      ? ''
      : `<p style="margin:0 0 8px;">${emailLink(args.unsubscribeUrl, 'Unsubscribe from this digest')} — no sign-in needed.</p>`) +
    `<p style="margin:0;">Questions? ${emailLink(`mailto:${SUPPORT_EMAIL}`, SUPPORT_EMAIL)}</p>`;

  // Origin extracted textually (the worker's TS lib types URL minimally);
  // renderEmailLayout re-validates the shape before using it.
  const logoOrigin = /^https:\/\/[a-z0-9.-]+(?::\d+)?/i.exec(args.appBaseUrl)?.[0];
  const html = renderEmailLayout({ subject, bodyHtml, footerHtml, logoOrigin });

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

  const summaryLine = totalCount > 0 ? `${summaryLabel}\n` : '';

  const text =
    `Daily digest for ${args.orgName}\n${args.digestDate}\n\n${summaryLine}${countsLine}\n${bodyText}\n` +
    `---\n` +
    `${NOTIFICATIONS_TED_ATTRIBUTION}\n` +
    `${NOTIFICATIONS_DECISION_SUPPORT_DISCLAIMER}\n` +
    `Manage digest preferences: ${args.manageUrl}\n` +
    `You are receiving this because your organization enabled the daily digest. ` +
    `You can turn it off any time from digest preferences.\n` +
    (args.unsubscribeUrl === null
      ? ''
      : `Unsubscribe (no sign-in needed): ${args.unsubscribeUrl}\n`) +
    `View in BidMorrow: ${args.appBaseUrl}/app\n` +
    `Questions? ${SUPPORT_EMAIL}\n`;

  return { subject, html, text };
}
