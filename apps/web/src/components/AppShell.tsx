import { useState, type ReactElement, type ReactNode } from 'react';
import { Link, useNavigate } from 'react-router';
import { PRODUCT_NAME } from '../copy';
import { useAuth } from '../lib/auth-context';

export function AppShell({ children }: { children: ReactNode }): ReactElement {
  const navigate = useNavigate();
  const { refresh } = useAuth();
  const [signOutError, setSignOutError] = useState<string | null>(null);

  async function signOut(): Promise<void> {
    setSignOutError(null);
    try {
      const response = await fetch('/api/auth/sign-out', {
        method: 'POST',
        credentials: 'include',
      });
      if (!response.ok) throw new Error(`sign-out failed: ${String(response.status)}`);
      await refresh();
      void navigate('/login');
    } catch {
      setSignOutError('Could not log out — please try again.');
    }
  }

  return (
    <>
      <a className="skip-link" href="#main-content">
        Skip to main content
      </a>
      <header className="site-header">
        <nav aria-label="Main">
          <Link className="product-name" to="/app">
            {PRODUCT_NAME}
          </Link>
          <ul className="nav-list">
            <li>
              <Link to="/app">Feed</Link>
            </li>
            <li>
              <Link to="/app/settings">Settings</Link>
            </li>
          </ul>
          <div className="nav-actions">
            <button type="button" onClick={() => void signOut()}>
              Log out
            </button>
          </div>
        </nav>
      </header>
      {signOutError !== null && (
        <p role="alert" className="form-error">
          {signOutError}
        </p>
      )}
      <main id="main-content">{children}</main>
    </>
  );
}
