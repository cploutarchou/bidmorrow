import { useState, type FormEvent, type ReactElement } from 'react';
import { Link, useNavigate } from 'react-router';
import { useAuth } from '../../lib/auth-context';
import { AuthLayout } from './AuthLayout';

interface SignInErrorBody {
  code?: string;
  message?: string;
}

export function Login(): ReactElement {
  const navigate = useNavigate();
  const { refresh } = useAuth();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [needsVerification, setNeedsVerification] = useState(false);
  const [submitting, setSubmitting] = useState(false);

  async function onSubmit(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    setError(null);
    setNeedsVerification(false);
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
          setError(body.message ?? 'Could not sign in — check your email and password.');
        }
        return;
      }
      await refresh();
      void navigate('/app');
    } catch {
      setError('Something went wrong. Please try again.');
    } finally {
      setSubmitting(false);
    }
  }

  async function resendVerification(): Promise<void> {
    await fetch('/api/auth/send-verification-email', {
      method: 'POST',
      credentials: 'include',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ email }),
    });
    void navigate('/verify-email');
  }

  return (
    <AuthLayout title="Log in">
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
      <p>
        <Link to="/forgot-password">Forgot your password?</Link>
      </p>
    </AuthLayout>
  );
}
