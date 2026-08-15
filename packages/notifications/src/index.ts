/**
 * @bidmorrow/notifications — digest generation + email provider interface.
 *
 * Phase 4: `EmailProvider` is the delivery-agnostic outbound-email contract
 * (fire-and-forget transactional mail — verification/password-reset — used
 * by `packages/auth`) and `createLoggingEmailProvider` is its dev/test stub.
 *
 * Phase 8: the digest pipeline (`digest-renderer.ts`,
 * `digest-orchestration.ts`, `resend.ts`) — a SEPARATE, always-awaited
 * `DigestEmailProvider` contract (SEC-P4-08: digest sends run inside a
 * queue consumer, where awaiting is correct, unlike the transactional
 * fire-and-forget hooks above). `createResendEmailProvider` is the real
 * provider; `createLoggingDigestEmailProvider` is its dev/test fallback
 * when `RESEND_API_KEY` is absent (local/test envs).
 */
import type { Logger } from '@bidmorrow/observability';

import type { DigestEmailProvider, DigestSendMessage, DigestSendResult } from './resend';

export * from './escape-html';
export * from './digest-renderer';
export * from './digest-orchestration';
export * from './resend';
export * from './auth-mail';

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

/**
 * Dev/test stub for the digest send path: "sends" nothing, records a
 * synthetic `providerMessageId` so callers exercising the sent/delivered
 * path in local dev never crash on a missing id. Logs `kind`/`to` ONLY,
 * matching `createLoggingEmailProvider` (docs/security.md C10). Used when
 * `RESEND_API_KEY` is absent — see apps/worker's provider wiring.
 */
export function createLoggingDigestEmailProvider(logger: Logger): DigestEmailProvider {
  let counter = 0;
  return {
    send(message: DigestSendMessage): Promise<DigestSendResult> {
      counter += 1;
      logger.info('digest email not sent: logging provider only (RESEND_API_KEY not configured)', {
        kind: message.kind,
        to: message.to,
      });
      return Promise.resolve({ providerMessageId: `logging-${counter}` });
    },
  };
}
