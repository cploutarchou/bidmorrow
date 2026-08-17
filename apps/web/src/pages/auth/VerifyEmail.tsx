import { useState, type ReactElement } from 'react';
import { Link, useSearchParams } from 'react-router';
import { AuthLayout } from './AuthLayout';

/**
 * Info page for the post-signup "check your inbox" state, and the landing
 * target Better Auth's verification link redirects to
 * (`/api/auth/verify-email?token=...&callbackURL=/verify-email?email=...`)
 * once the server has already verified the token. `error` is set by Better
 * Auth on an invalid/expired token per its documented redirect behavior.
 *
 * Fix for ux-strategy.md F10 (dead-end "check your inbox" pattern, no
 * resend affordance, no sender hint): a resend button (the endpoint already
 * exists) and the address it was sent to, when known via `?email=`
 * (Signup.tsx/Login.tsx's resend both pass it through the `callbackURL`).
 * There is no session yet at this point (Better Auth does not auto-sign-in
 * after email verification in this configuration), so the next real step
 * is always logging in — F11's routing-by-state (R1) happens there.
 */
export function VerifyEmail(): ReactElement {
  const [searchParams] = useSearchParams();
  const error = searchParams.get('error');
  const email = searchParams.get('email');
  const [resent, setResent] = useState(false);
  const [resendError, setResendError] = useState<string | null>(null);
  const [resending, setResending] = useState(false);

  async function resendVerification(): Promise<void> {
    if (email === null) return;
    setResending(true);
    setResendError(null);
    try {
      const response = await fetch('/api/auth/send-verification-email', {
        method: 'POST',
        credentials: 'include',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          email,
          callbackURL: `/verify-email?email=${encodeURIComponent(email)}`,
        }),
      });
      if (!response.ok) throw new Error(`resend failed: ${String(response.status)}`);
      setResent(true);
    } catch {
      setResendError('Could not resend the verification email. Please try again shortly.');
    } finally {
      setResending(false);
    }
  }

  return (
    <AuthLayout title="Verify your email">
      {error !== null ? (
        <>
          <p role="alert" className="form-error">
            That verification link is invalid or has expired.
          </p>
          <p>Try logging in again — we'll offer to resend the verification email from there.</p>
        </>
      ) : (
        <>
          <p>
            Check your inbox{email !== null ? ` for ${email}` : ''} for a verification email and
            click the link inside, then <Link to="/login">log in</Link>. Not there? Check your spam
            folder.
          </p>
          {email !== null && (
            <>
              <p role="status" aria-live="polite" className="visually-hidden-status">
                {resent ? 'Verification email resent.' : ''}
              </p>
              {resent && <p>Sent again — give it a minute to arrive.</p>}
              {resendError !== null && (
                <p role="alert" className="form-error">
                  {resendError}
                </p>
              )}
              <button
                type="button"
                className="link-button"
                disabled={resending}
                onClick={() => void resendVerification()}
              >
                {resending ? 'Resending…' : 'Resend verification email'}
              </button>
            </>
          )}
        </>
      )}
    </AuthLayout>
  );
}
