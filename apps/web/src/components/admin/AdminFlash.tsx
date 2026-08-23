import type { ReactElement } from 'react';

/**
 * Result of an admin mutation, shown to everyone.
 *
 * The pre-design pages rendered this same text inside
 * `.visually-hidden-status`, so an operator who suspended an organization,
 * rewrote a feature flag or paused ingestion saw no confirmation at all —
 * only a screen-reader user was told whether the action had taken. The
 * handoff design (`BidMorrow Admin.dc.html`) shows it as a live strip above
 * the page body, which is what this renders.
 *
 * It remains a polite live region, so nothing is lost for assistive tech; it
 * is simply no longer hidden from sight. `role="status"` already implies
 * `aria-live="polite"`, but both are written out because the redundancy is
 * what older screen readers actually honour.
 *
 * Rendered unconditionally rather than behind a `message !== null` guard:
 * a live region has to be in the DOM *before* its text changes for the
 * change to be announced. `.admin-flash:empty` hides the empty shell.
 */
export function AdminFlash({
  message,
  tone = 'ok',
}: {
  message: string | null;
  tone?: 'ok' | 'risk';
}): ReactElement {
  return (
    <p
      role="status"
      aria-live="polite"
      className={tone === 'risk' ? 'admin-flash admin-flash--risk' : 'admin-flash'}
    >
      {message}
    </p>
  );
}
