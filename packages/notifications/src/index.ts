/**
 * @bidmorrow/notifications — digest generation + email provider interface.
 *
 * Phase 4: `EmailProvider` is the delivery-agnostic outbound-email contract
 * and `createLoggingEmailProvider` is the dev/test stub used by the Worker
 * until the real Resend implementation arrives in Phase 8 (see
 * HUMAN_DECISION_BLOCKERS.md item 3 — Resend account is a human blocker).
 * The digest pipeline itself also arrives in Phase 8.
 */
import type { Logger } from '@bidmorrow/observability';

export const PACKAGE = '@bidmorrow/notifications';

/**
 * `transactional` (auth, billing — always sent) vs `digest` (daily match
 * digest — subject to pause and skip-when-empty rules).
 */
export const EMAIL_KINDS = ['transactional', 'digest'] as const;

export type EmailKind = (typeof EMAIL_KINDS)[number];

/**
 * A message ready to hand to a delivery provider. `text` may contain
 * sensitive links (verification/reset URLs) — providers MUST NOT log the
 * message body (docs/security.md C10); only `kind`/`to` are safe to log.
 */
export interface EmailMessage {
  readonly to: string;
  readonly kind: EmailKind;
  readonly subject: string;
  readonly text: string;
}

/** Delivery-agnostic outbound email contract. */
export interface EmailProvider {
  send(message: EmailMessage): Promise<void>;
}

/**
 * Dev/test stub: "sends" nothing, only records that a send was attempted.
 * Logs `kind` and `to` ONLY — never `subject`/`text`, which may carry a
 * verification or password-reset URL/token (docs/security.md C10). The real
 * Resend-backed provider arrives in Phase 8.
 */
export function createLoggingEmailProvider(logger: Logger): EmailProvider {
  return {
    async send(message) {
      logger.info('email not sent: logging provider only (real delivery arrives Phase 8)', {
        kind: message.kind,
        to: message.to,
      });
    },
  };
}
