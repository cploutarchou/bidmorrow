/**
 * Shared HTML email layout/brand primitives for every transactional email
 * this package sends (auth verify/reset — `auth-mail.ts`; daily digest —
 * `digest-renderer.ts`). Table-based, inline-CSS-only, 600px max width:
 * this is the layout style that survives Gmail/Outlook/Apple Mail's CSS
 * stripping, not a stylesheet + class-name approach (email clients do not
 * reliably support `<style>` blocks or external stylesheets, and this
 * package sends no remote images — the wordmark is styled text, never an
 * `<img>` or inline SVG, so a client that blocks remote/embedded assets by
 * default still renders a fully legible email).
 *
 * CSP note: the app's `style-src 'self'` policy (docs/security.md) governs
 * pages served by this codebase's own origin. It does not apply to emails
 * — an email is a standalone HTML document interpreted by a mail client,
 * not fetched through the app's CSP headers — so inline `style="…"`
 * attributes here are the correct, standard approach for email HTML, not
 * a CSP violation.
 *
 * Every dynamic value passed to `emailButton`/`emailLink` is HTML-escaped
 * inside this module, so callers pass raw (unescaped) strings.
 */
import { escapeHtml } from './escape-html';

/** Brand tokens — literal hex values only (no CSS custom properties: most
 * email clients do not resolve `var()`, and there is no stylesheet `:root`
 * to define them on). */
export const EMAIL_BRAND = {
  accent: '#0f7d6f',
  ink: '#0b1f1c',
  muted: '#5b6b68',
  border: '#e3e9e8',
  background: '#f4f7f6',
  surface: '#ffffff',
  fontStack: "-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif",
} as const;

const CONTAINER_STYLE =
  `width:100%;max-width:600px;margin:0 auto;background:${EMAIL_BRAND.surface};` +
  `border:1px solid ${EMAIL_BRAND.border};border-radius:8px;overflow:hidden;`;

const HEADER_CELL_STYLE = `padding:24px 32px;border-bottom:1px solid ${EMAIL_BRAND.border};background:${EMAIL_BRAND.surface};`;

const WORDMARK_STYLE =
  `margin:0;font-family:${EMAIL_BRAND.fontStack};font-size:20px;font-weight:700;` +
  `color:${EMAIL_BRAND.ink};letter-spacing:-0.01em;`;

const BODY_CELL_STYLE =
  `padding:32px;font-family:${EMAIL_BRAND.fontStack};color:${EMAIL_BRAND.ink};` +
  `font-size:15px;line-height:1.6;`;

const FOOTER_CELL_STYLE =
  `padding:24px 32px;border-top:1px solid ${EMAIL_BRAND.border};` +
  `font-family:${EMAIL_BRAND.fontStack};color:${EMAIL_BRAND.muted};font-size:12px;line-height:1.6;`;

const OUTER_BODY_STYLE = `margin:0;padding:24px 12px;background:${EMAIL_BRAND.background};`;

export const EMAIL_BUTTON_STYLE =
  `display:inline-block;background:${EMAIL_BRAND.accent};color:#ffffff;` +
  `padding:12px 24px;border-radius:6px;text-decoration:none;font-weight:600;` +
  `font-family:${EMAIL_BRAND.fontStack};font-size:15px;`;

export const EMAIL_LINK_STYLE = `color:${EMAIL_BRAND.accent};text-decoration:underline;`;

/** Renders a full HTML email document: brand header, body, footer, all
 * inside a single 600px table for consistent rendering across clients.
 * `bodyHtml`/`footerHtml` are caller-composed and must already be
 * HTML-safe (every source-derived value escaped via `escapeHtml` before
 * being placed there) — this function does not escape them itself, since
 * it needs to accept markup (links, headings), not just text. */
export function renderEmailLayout(args: {
  readonly subject: string;
  readonly bodyHtml: string;
  readonly footerHtml: string;
}): string {
  const titleSafe = escapeHtml(args.subject);
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="color-scheme" content="light">
<title>${titleSafe}</title>
</head>
<body style="${OUTER_BODY_STYLE}">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0">
<tr><td align="center">
<table role="presentation" cellpadding="0" cellspacing="0" border="0" style="${CONTAINER_STYLE}">
<tr><td style="${HEADER_CELL_STYLE}">
<p style="${WORDMARK_STYLE}">BidMorrow</p>
</td></tr>
<tr><td style="${BODY_CELL_STYLE}">
${args.bodyHtml}
</td></tr>
<tr><td style="${FOOTER_CELL_STYLE}">
${args.footerHtml}
</td></tr>
</table>
</td></tr>
</table>
</body>
</html>`;
}

/** A single primary call-to-action button. `url`/`label` are raw
 * (unescaped) — this escapes both before interpolation. */
export function emailButton(url: string, label: string): string {
  return `<a href="${escapeHtml(url)}" style="${EMAIL_BUTTON_STYLE}">${escapeHtml(label)}</a>`;
}

/** A plain inline text link (footer/manage/unsubscribe links). `url`/
 * `label` are raw (unescaped) — this escapes both before interpolation. */
export function emailLink(url: string, label: string): string {
  return `<a href="${escapeHtml(url)}" style="${EMAIL_LINK_STYLE}">${escapeHtml(label)}</a>`;
}
