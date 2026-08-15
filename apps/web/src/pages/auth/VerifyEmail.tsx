import type { ReactElement } from 'react';
import { Link, useSearchParams } from 'react-router';
import { AuthLayout } from './AuthLayout';

/**
 * Info page for the post-signup "check your inbox" state, and the landing
 * target Better Auth's verification link redirects to
 * (`/api/auth/verify-email?token=...&callbackURL=/verify-email`) once the
 * server has already verified the token. `error` is set by Better Auth on
 * an invalid/expired token per its documented redirect behavior.
 */
export function VerifyEmail(): ReactElement {
  const [searchParams] = useSearchParams();
  const error = searchParams.get('error');

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
        <p>
          Check your inbox for a verification email and click the link inside. Once verified, you
          can <Link to="/login">log in</Link>.
        </p>
      )}
    </AuthLayout>
  );
}
