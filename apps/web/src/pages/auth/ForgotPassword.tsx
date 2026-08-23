import { useState, type FormEvent, type ReactElement } from 'react';
import { AuthLayout } from './AuthLayout';

/**
 * Forgot password — with the failure modes separated honestly.
 *
 * Two very different things can happen after submit, and they must not share
 * one message. A 200 means the server accepted the request, and the
 * confirmation is deliberately identical whether or not the address is
 * registered — an unauthenticated caller is never told which accounts exist.
 * A network failure or a 5xx means NOTHING was sent, and showing the
 * confirmation anyway would leave someone waiting on an email that is not
 * coming. The first version of this page had no catch at all: a fetch
 * rejection escaped as an unhandled promise and the form just sat there.
 */
export function ForgotPassword(): ReactElement {
  const [email, setEmail] = useState('');
  const [sent, setSent] = useState(false);
  const [resent, setResent] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  async function requestReset(): Promise<void> {
    setError(null);
    setSubmitting(true);
    try {
      const response = await fetch('/api/auth/request-password-reset', {
        method: 'POST',
        credentials: 'include',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ email, redirectTo: '/reset-password' }),
      });
      if (!response.ok) {
        setError('Could not reach the server — nothing was sent. Please try again.');
        return;
      }
      if (sent) setResent(true);
      setSent(true);
    } catch {
      setError('Could not reach the server — nothing was sent. Please try again.');
    } finally {
      setSubmitting(false);
    }
  }

  async function onSubmit(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    // The forms are `noValidate` (custom messaging over browser bubbles), so
    // the checks the attributes imply run here instead.
    const trimmed = email.trim();
    if (trimmed.length === 0) {
      setError('Enter your email address.');
      return;
    }
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(trimmed)) {
      setError('That does not look like an email address — check it and try again.');
      return;
    }
    await requestReset();
  }

  return (
    <AuthLayout
      title="Reset your password"
      subtitle={sent ? 'Check your inbox.' : 'We send a single-use link that expires.'}
    >
      {sent ? (
        <>
          <p role="status" className="auth-status">
            {resent
              ? 'Sent again. If an account exists for that email, a new password reset link is on its way.'
              : 'If an account exists for that email, a password reset link has been sent.'}
          </p>
          <p className="auth-note">
            The same confirmation shows whether or not the address is registered — an
            unauthenticated caller is never told which accounts exist.
          </p>
          {error !== null && (
            <p role="alert" className="form-error">
              {error}
            </p>
          )}
          <button
            type="button"
            className="btn-quiet"
            disabled={submitting}
            onClick={() => void requestReset()}
          >
            {submitting ? 'Sending…' : 'Send it again'}
          </button>
        </>
      ) : (
        <form onSubmit={(event) => void onSubmit(event)} noValidate>
          {error !== null && (
            <p role="alert" className="form-error">
              {error}
            </p>
          )}
          <div className="form-field">
            <label htmlFor="forgot-email">Email</label>
            <input
              id="forgot-email"
              name="email"
              type="email"
              autoComplete="email"
              placeholder="you@company.eu"
              required
              value={email}
              onChange={(event) => setEmail(event.target.value)}
            />
          </div>
          <button className="cta" type="submit" disabled={submitting}>
            {submitting ? 'Sending…' : 'Send reset link'}
          </button>
        </form>
      )}
    </AuthLayout>
  );
}
