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
import { SUPPORT_EMAIL } from './copy';
import { EMAIL_BRAND, emailButton, emailLink, renderEmailLayout } from './email-layout';
import { escapeHtml } from './escape-html';
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
 * user-controlled procurement content — so, unlike digest content, it
 * carries no XSS risk on its own — but it is still run through
 * `escapeHtml` before landing in the HTML body (belt-and-suspenders,
 * consistent with "every dynamic value goes through the escape helper").
 * The plain-text body never escapes it: a real, clickable, human-readable
 * URL is the point of the text alternative.
 *
 * No expiry note: Better Auth's verification/reset token lifetime is not
 * configured/threaded into this module (docs/dependency-versions.md has
 * no recorded value either), so stating a duration here would be a
 * fabricated number. Add an `expiresInMinutes` parameter here (and thread
 * it from wherever Better Auth's lifetime is finally configured) rather
 * than hardcoding one from memory.
 */
export function buildAuthEmailBody(kind: AuthEmailKind, url: string): AuthEmailBody {
  const isVerification = kind === 'verification';
  const subject = isVerification ? 'Verify your email address' : 'Reset your password';
  const headline = subject;
  const bodyLine = isVerification
    ? 'Confirm this email address to finish setting up your BidMorrow account.'
    : 'Use the button below to choose a new password for your BidMorrow account.';
  const buttonLabel = isVerification ? 'Verify email address' : 'Reset password';
  const ignoreLine = "If you didn't request this, you can safely ignore this email.";

  const text = [
    headline,
    '',
    bodyLine,
    '',
    url,
    '',
    ignoreLine,
    '',
    `Questions? ${SUPPORT_EMAIL}`,
  ].join('\n');

  const bodyHtml =
    `<h1 style="margin:0 0 12px;font-size:20px;color:${EMAIL_BRAND.ink};">${escapeHtml(headline)}</h1>` +
    `<p style="margin:0 0 20px;">${escapeHtml(bodyLine)}</p>` +
    `<p style="margin:0 0 20px;">${emailButton(url, buttonLabel)}</p>` +
    `<p style="margin:0 0 8px;color:${EMAIL_BRAND.muted};font-size:13px;">If the button above does not work, copy and paste this link into your browser:</p>` +
    `<p style="margin:0 0 20px;font-size:13px;word-break:break-all;color:${EMAIL_BRAND.muted};">${escapeHtml(url)}</p>` +
    `<p style="margin:0;color:${EMAIL_BRAND.muted};font-size:13px;">${escapeHtml(ignoreLine)}</p>`;

  const footerHtml = `<p style="margin:0;">Questions? ${emailLink(`mailto:${SUPPORT_EMAIL}`, SUPPORT_EMAIL)}</p>`;

  const html = renderEmailLayout({ subject, bodyHtml, footerHtml });

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
