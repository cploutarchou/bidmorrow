import { useState, type FormEvent, type ReactElement } from 'react';
import { useNavigate } from 'react-router';
import { Link } from 'react-router';
import { LaunchCountdown } from '../../components/LaunchCountdown';
import { usePublicConfig } from '../../lib/public-config';
import { useRedirectIfAuthenticated } from '../../lib/use-redirect-if-authenticated';
import { AuthLayout } from './AuthLayout';

interface SignUpErrorBody {
  code?: string;
  message?: string;
}

export function Signup(): ReactElement {
  const navigate = useNavigate();
  // Already-authenticated visitor landing on /signup must not see the form
  // (auth/session-flow-polish R1) — this must run for every render, so it's
  // declared before the early loading-state return below.
  const { ready } = useRedirectIfAuthenticated();
  const publicConfig = usePublicConfig();
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  async function onSubmit(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    setError(null);
    setSubmitting(true);
    try {
      // callbackURL carries `?email=` through Better Auth's redirect after
      // the emailed link is followed (fix for ux-strategy.md F10: the
      // "check your inbox" page previously couldn't say which inbox — pure
      // display text, never used for anything security-sensitive).
      const verifyEmailPath = `/verify-email?email=${encodeURIComponent(email)}`;
      const response = await fetch('/api/auth/sign-up/email', {
        method: 'POST',
        credentials: 'include',
        headers: { 'content-type': 'application/json' },
        // callbackURL: Better Auth's verify-email endpoint redirects here
        // (success and `?error=...` alike) after the link is followed —
        // without it, it defaults to '/' and VerifyEmail's error banner
        // (reads `?error=` from ITS OWN route) would never be reachable.
        // Found via Phase 12 E2E: following a real captured verification
        // link and asserting it lands back on /verify-email.
        body: JSON.stringify({ name, email, password, callbackURL: verifyEmailPath }),
      });
      if (!response.ok) {
        const body = (await response.json().catch(() => ({}))) as SignUpErrorBody;
        setError(body.message ?? 'Sign up failed. Please check your details and try again.');
        return;
      }
      void navigate(verifyEmailPath);
    } catch {
      setError('Something went wrong. Please try again.');
    } finally {
      setSubmitting(false);
    }
  }

  if (!ready) {
    return (
      <main id="main-content">
        <p>Loading…</p>
      </main>
    );
  }

  // Pre-launch (public-config): registrations are closed in production
  // until the go-live flag flip; the server refuses sign-up with 403
  // regardless, this is the honest UI for it. Log-in stays open.
  if (publicConfig?.prelaunch === true) {
    return (
      <AuthLayout
        title="Registrations open at launch"
        subtitle="We are putting the final pieces in place — new accounts open when the countdown ends."
      >
        <div className="auth-sentbox">
          <p className="auth-sentbox__cap">Launch</p>
          <p className="auth-sentbox__addr">
            <LaunchCountdown launchDate={publicConfig.launchDate} />
          </p>
        </div>
        <p className="auth-note">
          Already have an account? <Link to="/login">Log in</Link> — existing accounts are not
          affected.
        </p>
        <Link className="cta" to="/">
          Back to the homepage
        </Link>
      </AuthLayout>
    );
  }

  const pwLongEnough = password.length >= 8;
  const pwHint =
    password.length === 0
      ? '8 characters minimum'
      : pwLongEnough
        ? 'Long enough'
        : `${String(8 - password.length)} more characters needed`;
  const pwHintClass =
    password.length === 0
      ? 'pw-hint'
      : pwLongEnough
        ? 'pw-hint pw-hint--ok'
        : 'pw-hint pw-hint--warn';

  return (
    <AuthLayout
      title="Create your account"
      subtitle="One account per person; organizations are joined or created during onboarding."
    >
      <form onSubmit={(event) => void onSubmit(event)} noValidate>
        {error !== null && (
          <p role="alert" className="form-error">
            {error}
          </p>
        )}
        <div className="form-field">
          <label htmlFor="signup-name">Full name</label>
          <input
            id="signup-name"
            name="name"
            type="text"
            autoComplete="name"
            required
            value={name}
            onChange={(event) => setName(event.target.value)}
          />
        </div>
        <div className="form-field">
          <label htmlFor="signup-email">Work email</label>
          <input
            id="signup-email"
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
          <label htmlFor="signup-password">Password</label>
          <input
            id="signup-password"
            name="password"
            type="password"
            autoComplete="new-password"
            minLength={8}
            required
            aria-describedby="signup-password-hint"
            value={password}
            onChange={(event) => setPassword(event.target.value)}
          />
          <span id="signup-password-hint" className={pwHintClass}>
            {pwHint}
          </span>
        </div>
        <button className="cta" type="submit" disabled={submitting}>
          {submitting ? 'Creating account…' : 'Create account'}
        </button>
      </form>
      <p className="auth-note">
        Verification is required before the first login — the account exists, but the feed stays
        closed until the emailed link is followed.
      </p>
    </AuthLayout>
  );
}
