/**
 * Auth transactional email (SEC-P11-02): the Resend-backed provider for
 * Better Auth's two fire-and-forget hooks (`sendVerificationEmail` /
 * `sendResetPassword`, wired in `apps/worker/src/auth-instance.ts`). Kept
 * separate from `EmailProvider` (the dev/test logging stub in `index.ts`,
 * still used when Resend is not configured) because only a real send needs
 * a composed html body — the logging stub only ever needs kind/to
 * (docs/security.md C10: it never logs `url`/subject/html/text, and this
 * module does not log at all).
 */
import { createResendEmailProvider, type CreateResendEmailProviderArgs } from './resend';

export type AuthEmailKind = 'verification' | 'password_reset';

export interface AuthEmailMessage {
  readonly to: string;
  readonly kind: AuthEmailKind;
  /** Better Auth's own generated, HMAC-signed verification/reset link. */
  readonly url: string;
}

/** Delivery-agnostic contract for the auth transactional-email hooks. */
export interface AuthEmailProvider {
  send(message: AuthEmailMessage): Promise<void>;
}

export interface AuthEmailBody {
  readonly subject: string;
  readonly text: string;
  readonly html: string;
}

/**
 * Builds the subject/text/html body for an auth transactional email. `url`
 * is BidMorrow's own outbound link (Better Auth-generated), not
 * user-controlled procurement content, so it does not need HTML-escaping
 * the way tender/procurement data would (docs/security.md C10's escaping
 * requirement is about untrusted TED content, not our own signed links) —
 * still, it is injected as-is with no surrounding untrusted content, so
 * there is nothing else in this template that requires escaping either.
 */
export function buildAuthEmailBody(kind: AuthEmailKind, url: string): AuthEmailBody {
  const subject = kind === 'verification' ? 'Verify your email address' : 'Reset your password';
  const action = kind === 'verification' ? 'verify your email address' : 'reset your password';
  const text = [
    subject,
    '',
    `Click the link below to ${action}:`,
    url,
    '',
    'If you did not request this, you can safely ignore this email.',
  ].join('\n');
  const html = `<!doctype html>
<html>
  <body style="font-family:-apple-system,Helvetica,Arial,sans-serif;max-width:480px;margin:0 auto;padding:24px;color:#111827;">
    <p style="font-weight:600;font-size:16px;margin:0 0 16px;">BidMorrow</p>
    <p>Click the button below to ${action}.</p>
    <p style="margin:24px 0;">
      <a href="${url}" style="display:inline-block;background:#111827;color:#ffffff;padding:10px 20px;border-radius:6px;text-decoration:none;font-weight:600;">${subject}</a>
    </p>
    <p style="color:#6b7280;font-size:13px;">If the button does not work, copy this link into your browser:<br>${url}</p>
    <p style="color:#6b7280;font-size:13px;">If you did not request this, you can safely ignore this email.</p>
  </body>
</html>`;
  return { subject, text, html };
}

/**
 * Creates a Resend-backed provider for auth transactional email. Reuses
 * `createResendEmailProvider`'s already-tested fetch/retry/rate-limit
 * implementation (`kind: 'transactional'` in its vocabulary) rather than
 * duplicating the Resend HTTP call — this function's only job is composing
 * the auth-specific body via `buildAuthEmailBody`.
 */
export function createResendAuthEmailProvider(
  args: CreateResendEmailProviderArgs,
): AuthEmailProvider {
  const provider = createResendEmailProvider(args);
  return {
    async send({ to, kind, url }: AuthEmailMessage): Promise<void> {
      const body = buildAuthEmailBody(kind, url);
      await provider.send({
        to,
        kind: 'transactional',
        subject: body.subject,
        html: body.html,
        text: body.text,
      });
    },
  };
}
