/**
 * HTML-escapes a raw string for safe interpolation into the digest email's
 * HTML body. Procurement content (lot titles, buyer names) is untrusted
 * input (docs/security.md C2) — this is the ONLY place raw source text is
 * allowed to touch an HTML template, and every source-derived value in
 * `digest-renderer.ts` MUST go through it. No raw source HTML is ever
 * rendered — this escapes, it never sanitizes/allows any markup through.
 */
export function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}
