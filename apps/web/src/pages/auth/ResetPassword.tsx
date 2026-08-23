import { useState, type FormEvent, type ReactElement } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router';
import { AuthLayout } from './AuthLayout';

interface ResetErrorBody {
  message?: string;
}

export function ResetPassword(): ReactElement {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const token = searchParams.get('token');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  async function onSubmit(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    if (token === null) {
      setError('This reset link is missing its token — request a new one.');
      return;
    }
    if (password.length < 8) {
      setError('Passwords need at least 8 characters.');
      return;
    }
    setError(null);
    setSubmitting(true);
    try {
      const response = await fetch('/api/auth/reset-password', {
        method: 'POST',
        credentials: 'include',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ newPassword: password, token }),
      });
      if (!response.ok) {
        const body = (await response.json().catch(() => ({}))) as ResetErrorBody;
        setError(body.message ?? 'Could not reset your password — the link may have expired.');
        return;
      }
      // Login shows the reset-done confirmation off this state — without
      // it the flow silently bounced to the form with no sign it worked.
      void navigate('/login', { state: { passwordReset: true } });
    } catch {
      setError('Something went wrong. Please try again.');
    } finally {
      setSubmitting(false);
    }
  }

  if (token === null) {
    return (
      <AuthLayout title="Reset your password" subtitle="This link cannot be used.">
        <p role="alert" className="form-error">
          This link is missing a reset token. Request a new link from{' '}
          <Link to="/forgot-password">forgot password</Link>.
        </p>
        <Link className="cta" to="/forgot-password">
          Request a new link
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
    <AuthLayout title="Choose a new password" subtitle="Set a new password and log in again.">
      <form onSubmit={(event) => void onSubmit(event)} noValidate>
        {error !== null && (
          <p role="alert" className="form-error">
            {error}
          </p>
        )}
        <div className="form-field">
          <label htmlFor="reset-password">New password</label>
          <input
            id="reset-password"
            name="password"
            type="password"
            autoComplete="new-password"
            minLength={8}
            required
            aria-describedby="reset-password-hint"
            value={password}
            onChange={(event) => setPassword(event.target.value)}
          />
          <span id="reset-password-hint" className={pwHintClass}>
            {pwHint}
          </span>
        </div>
        <button className="cta" type="submit" disabled={submitting}>
          {submitting ? 'Saving…' : 'Set new password'}
        </button>
      </form>
    </AuthLayout>
  );
}
