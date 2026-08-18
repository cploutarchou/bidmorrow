import { useState, type FormEvent, type ReactElement } from 'react';
import { AuthLayout } from './AuthLayout';

export function ForgotPassword(): ReactElement {
  const [email, setEmail] = useState('');
  const [sent, setSent] = useState(false);
  const [submitting, setSubmitting] = useState(false);

  async function onSubmit(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    setSubmitting(true);
    try {
      await fetch('/api/auth/request-password-reset', {
        method: 'POST',
        credentials: 'include',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ email, redirectTo: '/reset-password' }),
      });
      // Always show the same confirmation regardless of whether the email
      // exists — never reveal account existence to an unauthenticated caller.
      setSent(true);
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <AuthLayout title="Reset your password">
      {sent ? (
        <p role="status">
          If an account exists for that email, a password reset link has been sent.
        </p>
      ) : (
        <form onSubmit={(event) => void onSubmit(event)} noValidate>
          <div className="form-field">
            <label htmlFor="forgot-email">Email</label>
            <input
              id="forgot-email"
              name="email"
              type="email"
              autoComplete="email"
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
