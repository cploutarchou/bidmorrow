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
      void navigate('/login');
    } catch {
      setError('Something went wrong. Please try again.');
    } finally {
      setSubmitting(false);
    }
  }

  if (token === null) {
    return (
      <AuthLayout title="Reset your password">
        <p role="alert" className="form-error">
          This link is missing a reset token. Request a new link from{' '}
          <Link to="/forgot-password">forgot password</Link>.
        </p>
      </AuthLayout>
    );
  }

  return (
    <AuthLayout title="Choose a new password">
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
            value={password}
            onChange={(event) => setPassword(event.target.value)}
          />
        </div>
        <button className="cta" type="submit" disabled={submitting}>
          {submitting ? 'Saving…' : 'Set new password'}
        </button>
      </form>
    </AuthLayout>
  );
}
