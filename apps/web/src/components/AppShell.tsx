import '../styles/app.css';
import { ShieldCheck } from 'lucide-react';
import { useState, type ReactElement, type ReactNode } from 'react';
import { Link, useLocation, useNavigate } from 'react-router';
import { PRODUCT_NAME } from '../copy';
import { useAuth } from '../lib/auth-context';
import { feedPathForView, parseFeedView } from '../lib/feed-view';
import { RouteTransition } from '../lib/lazy-page';
import { Logo } from './Logo';
import { ThemeToggle } from './ThemeToggle';
import { NoIndex } from './NoIndex';

/**
 * Customer app chrome — navigation model per
 * docs/redesign/navigation-and-admin-entry.md §2: one primary nav (Feed,
 * Saved, Settings, Billing) plus an "Admin" entry that renders ONLY when
 * `useAuth().isAdmin` is true. The Admin link is a discoverability
 * affordance, never a security boundary: the server 404-cloaks and
 * authorizes every `/api/admin/*` request on its own, and `AdminGate`
 * re-probes before rendering anything.
 */
export function AppShell({ children }: { children: ReactNode }): ReactElement {
  const navigate = useNavigate();
  const location = useLocation();
  const { refresh, user, isAdmin } = useAuth();
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

  const onFeed = location.pathname === '/app' || location.pathname.startsWith('/app/tenders/');
  const feedView = parseFeedView(new URLSearchParams(location.search).get('view'));
  const isSaved = onFeed && feedView === 'saved';
  const isFeed = onFeed && !isSaved;
  const onSettings = location.pathname.startsWith('/app/settings');
  const isBilling = onSettings && location.hash === '#billing';
  const isSettings = onSettings && !isBilling;
  const signedInAs = user?.email ?? 'your account';

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
              <Link to={feedPathForView('saved')} aria-current={isSaved ? 'page' : undefined}>
                Saved
              </Link>
            </li>
            <li>
              <Link to="/app/settings" aria-current={isSettings ? 'page' : undefined}>
                Settings
              </Link>
            </li>
            <li>
              <Link to="/app/settings#billing" aria-current={isBilling ? 'page' : undefined}>
                Billing
              </Link>
            </li>
            {isAdmin && (
              <li>
                <Link
                  className="app-nav-admin"
                  to="/admin"
                  aria-current={location.pathname.startsWith('/admin') ? 'page' : undefined}
                >
                  <ShieldCheck aria-hidden="true" size={15} strokeWidth={2.2} />
                  Admin
                </Link>
              </li>
            )}
          </ul>
          <div className="app-nav-actions">
            <ThemeToggle />
            <span className="app-avatar" role="img" aria-label={`Signed in as ${signedInAs}`}>
              {initials}
            </span>
            <button className="btn-quiet btn-sm" type="button" onClick={() => void signOut()}>
              Log out
            </button>
          </div>
          <div className="app-nav-status" role="alert" aria-live="assertive">
            {signOutError !== null && <p className="form-error">{signOutError}</p>}
          </div>
        </nav>
      </header>
      <main id="main-content" className="app-main">
        {/* Key off pathname+search, not `children` identity — see
            `RouteTransition`'s own header comment (lib/lazy-page.tsx) for
            why: `location` here already resolves to the tender slide-over's
            `backgroundLocation` while the sheet is open (react-router scopes
            `useLocation()` to whatever the enclosing `<Routes location>`
            override was), so this key is unchanged across the sheet's
            open/close and only changes on a real Feed/Settings/etc.
            navigation. */}
        <RouteTransition transitionKey={location.pathname + location.search}>
          {children}
        </RouteTransition>
      </main>
    </>
  );
}
