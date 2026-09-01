import { useState, type FormEvent, type ReactElement } from 'react';
import { Link, useNavigate, useLocation } from 'react-router';
import { useAuth } from '../../lib/auth-context';
import { useRedirectIfAuthenticated } from '../../lib/use-redirect-if-authenticated';
import { AuthLayout } from './AuthLayout';

interface SignInErrorBody {
  code?: string;
  message?: string;
}

export function Login(): ReactElement {
  const navigate = useNavigate();
  const { refresh } = useAuth();
  // Already-authenticated visitor landing on /login must not see the form
  // (auth/session-flow-polish R1): this must run for every render, so it's
  // declared before the early loading-state return below. Also owns
  // post-login navigation: once `refresh()` below resolves to a session,
  // `user` flips non-null and this hook's own effect resolves the
  // destination and navigates: a single code path instead of duplicating
  // `resolvePostAuthDestination` here too (which raced it and could
  // double-fetch `/api/org/profile` / navigate twice).
  const { ready } = useRedirectIfAuthenticated();
  // ResetPassword lands here with `state.passwordReset`: the reset-done
  // confirmation the flow otherwise never showed (a silent bounce to the
  // login form read as "did that work?").
  const location = useLocation();
  const passwordReset =
    (location.state as { passwordReset?: boolean } | null)?.passwordReset === true;
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [needsVerification, setNeedsVerification] = useState(false);
  const [submitting, setSubmitting] = useState(false);

  async function onSubmit(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    setError(null);
    setNeedsVerification(false);
    // The form is `noValidate` (custom messaging over browser bubbles), so
    // the checks the attributes imply run here.
    if (email.trim().length === 0 || password.length === 0) {
      setError('Enter your email and password.');
      return;
    }
    setSubmitting(true);
    try {
      const response = await fetch('/api/auth/sign-in/email', {
        method: 'POST',
        credentials: 'include',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ email, password }),
      });
      if (!response.ok) {
        const body = (await response.json().catch(() => ({}))) as SignInErrorBody;
        if (response.status === 403 && body.code === 'EMAIL_NOT_VERIFIED') {
          setNeedsVerification(true);
        } else {
          setError(body.message ?? 'Could not sign in. Check your email and password.');
        }
        return;
      }
      // R1 (docs/redesign/ux-strategy.md §1.3): route by state, not a fixed
      // URL. `refresh()` flips `user` from null to the signed-in account;
      // `useRedirectIfAuthenticated` above reacts to that and does the
      // `resolvePostAuthDestination` + navigate: an explicit `returnTo`
      // wins, else a new/incomplete profile lands on /onboarding instead of
      // hitting the feed's 403 dead-end.
      await refresh();
    } catch {
      setError('Something went wrong. Please try again.');
    } finally {
      setSubmitting(false);
    }
  }

  async function resendVerification(): Promise<void> {
    // Same callbackURL fix as Signup.tsx; see its comment (carries
    // `?email=` through so VerifyEmail can show the resend affordance).
    const verifyEmailPath = `/verify-email?email=${encodeURIComponent(email)}`;
    await fetch('/api/auth/send-verification-email', {
      method: 'POST',
      credentials: 'include',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ email, callbackURL: verifyEmailPath }),
    });
    void navigate(verifyEmailPath);
  }

  if (!ready) {
    return (
      <main id="main-content">
        <p>Loading…</p>
      </main>
    );
  }

  return (
    <AuthLayout
      title="Log in"
      subtitle="Email and password. Where you land is worked out after you are signed in."
    >
      {passwordReset && (
        <p role="status" className="auth-status">
          Password updated. Log in with your new password.
        </p>
      )}
      <form onSubmit={(event) => void onSubmit(event)} noValidate>
        {error !== null && (
          <p role="alert" className="form-error">
            {error}
          </p>
        )}
        {needsVerification && (
          <p role="alert" className="form-warning">
            Please verify your email before logging in.{' '}
            <button type="button" className="link-button" onClick={() => void resendVerification()}>
              Resend verification email
            </button>
          </p>
        )}
        <div className="form-field">
          <label htmlFor="login-email">Email</label>
          <input
            id="login-email"
            name="email"
            type="email"
            autoComplete="email"
            placeholder="you@company.eu"
            required
            value={email}
            onChange={(event) => setEmail(event.target.value)}
          />
        </div>
        <div className="form-field">
          <label htmlFor="login-password">Password</label>
          <input
            id="login-password"
            name="password"
            type="password"
            autoComplete="current-password"
            required
            value={password}
            onChange={(event) => setPassword(event.target.value)}
          />
        </div>
        <button className="cta" type="submit" disabled={submitting}>
          {submitting ? 'Logging in…' : 'Log in'}
        </button>
      </form>
      <div className="auth-links">
        <Link to="/forgot-password">Forgot your password?</Link>
        <Link className="auth-link--muted" to="/signup">
          Create an account
        </Link>
      </div>
    </AuthLayout>
  );
}
