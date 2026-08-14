/**
 * @bidmorrow/notifications — digest generation + email provider interface.
 *
 * Phase 2 skeleton: the digest pipeline and the Resend implementation arrive
 * in Phase 8. This module owns the coarse outbound-email kind split used to
 * route and rate outbound mail.
 */

export const PACKAGE = '@bidmorrow/notifications';

/**
 * `transactional` (auth, billing — always sent) vs `digest` (daily match
 * digest — subject to pause and skip-when-empty rules).
 */
export const EMAIL_KINDS = ['transactional', 'digest'] as const;

export type EmailKind = (typeof EMAIL_KINDS)[number];
