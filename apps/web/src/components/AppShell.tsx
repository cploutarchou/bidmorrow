import '../styles/app.css';
import { useState, type ReactElement, type ReactNode } from 'react';
import { Link, useLocation, useNavigate } from 'react-router';
import { PRODUCT_NAME } from '../copy';
import { useAuth } from '../lib/auth-context';
import { Logo } from './Logo';
import { ThemeToggle } from './ThemeToggle';
import { NoIndex } from './NoIndex';

export function AppShell({ children }: { children: ReactNode }): ReactElement {
  const navigate = useNavigate();
  const location = useLocation();
  const { refresh, user } = useAuth();
  // Avatar initials from the signed-in account (handoff header) — falls
  // back to the email's first letter, then a generic mark.
  const initials = (() => {
    const name = user?.name?.trim() ?? '';
    if (name.length > 0) {
      const parts = name.split(/\s+/);
      const first = parts[0]?.[0] ?? '';
      const last = parts.length > 1 ? (parts[parts.length - 1]?.[0] ?? '') : '';
      return `${first}${last}`.toUpperCase();
    }
    const email = user?.email ?? '';
    return email.length > 0 ? (email[0]?.toUpperCase() ?? '·') : '·';
  })();
  const [signOutError, setSignOutError] = useState<string | null>(null);
  const isFeed = location.pathname === '/app' || location.pathname.startsWith('/app/tenders/');
  const isSettings = location.pathname.startsWith('/app/settings');

  async function signOut(): Promise<void> {
    setSignOutError(null);
    try {
      // Better Auth requires a JSON content type + body on sign-out — a bare
      // POST is rejected with 415 (caught by the E2E logout spec).
      const response = await fetch('/api/auth/sign-out', {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: '{}',
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
      <NoIndex />
      <a className="skip-link" href="#main-content">
        Skip to main content
      </a>
      <header className="app-header glass">
        <nav className="app-header-inner" aria-label="Main">
          <Link className="app-wordmark" to="/app">
            <Logo className="brand-mark" />
            {PRODUCT_NAME}
          </Link>
          <ul className="app-nav-list">
            <li>
              <Link to="/app" aria-current={isFeed ? 'page' : undefined}>
                Feed
              </Link>
            </li>
            <li>
              <Link to="/app/settings" aria-current={isSettings ? 'page' : undefined}>
                Settings
              </Link>
            </li>
          </ul>
          <div className="app-nav-actions">
            <ThemeToggle />
            <button className="btn-quiet btn-sm" type="button" onClick={() => void signOut()}>
              Log out
            </button>
            <span className="app-avatar" aria-hidden="true">
              {initials}
            </span>
          </div>
        </nav>
      </header>
      {signOutError !== null && (
        <p role="alert" className="form-error">
          {signOutError}
        </p>
      )}
      <main id="main-content" className="app-main">
        {children}
      </main>
    </>
  );
}
