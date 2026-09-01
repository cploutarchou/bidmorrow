import '../../styles/admin.css';
import { useState, type ReactElement, type ReactNode } from 'react';
import { Link, useLocation, useNavigate } from 'react-router';
import type { AdminRailCounts } from '../../lib/admin-types';
import { useAuth } from '../../lib/auth-context';
import { ThemeToggle } from '../ThemeToggle';
import { NoIndex } from '../NoIndex';
import { useAdminOps } from './admin-health';

interface AdminNavItem {
  to: string;
  label: string;
  countKey?: keyof AdminRailCounts;
}

/**
 * Rail groups (docs/redesign/navigation-and-admin-entry.md §2): the ten
 * sections read as four questions (is the system healthy, who are the
 * customers, is the pipeline moving, what did we change) instead of a
 * flat list the on-call reader re-scans every time.
 */
const ADMIN_NAV_GROUPS: { caption: string; items: AdminNavItem[] }[] = [
  { caption: 'Overview', items: [{ to: '/admin', label: 'Dashboard' }] },
  {
    caption: 'Customers',
    items: [
      { to: '/admin/orgs', label: 'Organizations', countKey: 'organizations' },
      { to: '/admin/users', label: 'Users', countKey: 'users' },
      { to: '/admin/subscriptions', label: 'Subscriptions', countKey: 'subscriptions' },
    ],
  },
  {
    caption: 'Pipeline',
    items: [
      { to: '/admin/ingestion', label: 'Ingestion', countKey: 'ingestionRuns' },
      { to: '/admin/matching', label: 'Matching' },
      { to: '/admin/digest', label: 'Digest', countKey: 'digestRuns' },
    ],
  },
  {
    caption: 'Governance',
    items: [
      { to: '/admin/support', label: 'Support', countKey: 'supportNotes' },
      { to: '/admin/audit', label: 'Audit', countKey: 'auditEvents' },
      { to: '/admin/flags', label: 'Flags', countKey: 'flags' },
    ],
  },
];

/**
 * Internal-tooling shell: 2026-08-21 handoff redesign (`BidMorrow
 * Admin.dc.html`): header strip with the audited-surface note, and a
 * sticky left section rail with a left-mark active state. Deliberately
 * distinct from the customer `AppShell`, but no longer a dead end: the
 * header carries who is signed in, a way back to the customer app and a
 * sign-out. Never a security boundary: reachability here already implies
 * the `/api/admin/health-details` probe succeeded (`AdminGate`), and every
 * page still gets its data solely from the server, which independently
 * authorizes every request.
 */
export function AdminShell({ children }: { children: ReactNode }): ReactElement {
  const location = useLocation();
  const navigate = useNavigate();
  const { user, refresh } = useAuth();
  const ops = useAdminOps();
  const health = ops?.health ?? null;
  const railCounts = ops?.railCounts ?? null;
  const [signOutError, setSignOutError] = useState<string | null>(null);

  function isCurrent(to: string): boolean {
    if (to === '/admin') return location.pathname === '/admin';
    return location.pathname === to || location.pathname.startsWith(`${to}/`);
  }

  async function signOut(): Promise<void> {
    setSignOutError(null);
    try {
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
      setSignOutError('Could not log out. Please try again.');
    }
  }

  return (
    <div className="admin-shell">
      <NoIndex />
      <a className="skip-link" href="#admin-main">
        Skip to main content
      </a>
      <header className="admin-header">
        <div className="admin-header__inner">
          <div className="admin-header__id">
            <p className="admin-header__title">BidMorrow Internal Admin</p>
            <p className="admin-header__note">
              Internal ops tooling, not a customer surface. Every request here is audited.
            </p>
          </div>
          <div className="admin-header__actions">
            {/* Ops pills (prototype header): live pause state from the same
              health-details response that authorized the surface. The
              prototype's third pill (audit-event count) lives in the rail
              instead: one source, not two. */}
            {health !== null && (
              <>
                <span
                  className={
                    health.ingestion.paused
                      ? 'admin-ops-pill admin-ops-pill--paused'
                      : 'admin-ops-pill admin-ops-pill--ok'
                  }
                >
                  {health.ingestion.paused ? 'ingestion paused' : 'ingestion ok'}
                </span>
                <span
                  className={
                    health.digest.paused
                      ? 'admin-ops-pill admin-ops-pill--paused'
                      : 'admin-ops-pill admin-ops-pill--ok'
                  }
                >
                  {health.digest.paused ? 'digest paused' : 'digest ok'}
                </span>
              </>
            )}
            <span className="admin-header__who" title={user?.email ?? undefined}>
              {user?.email ?? '–'}
            </span>
            <Link className="admin-header__link" to="/app">
              ← Open app
            </Link>
            <ThemeToggle />
            <button
              className="admin-header__link admin-header__link--button"
              type="button"
              onClick={() => void signOut()}
            >
              Log out
            </button>
          </div>
          <div className="admin-header__status" role="alert" aria-live="assertive">
            {signOutError !== null && <p className="form-error">{signOutError}</p>}
          </div>
        </div>
      </header>
      <div className="admin-split">
        <nav aria-label="Admin sections" className="admin-rail">
          {ADMIN_NAV_GROUPS.map((group) => (
            <div className="admin-rail__group" key={group.caption}>
              <p className="admin-rail__caption">{group.caption}</p>
              {group.items.map((item) => (
                <Link
                  key={item.to}
                  to={item.to}
                  aria-current={isCurrent(item.to) ? 'page' : undefined}
                >
                  {item.label}
                  {railCounts !== null && item.countKey !== undefined && (
                    <span className="admin-rail__count num">{railCounts[item.countKey]}</span>
                  )}
                </Link>
              ))}
            </div>
          ))}
        </nav>
        <main id="admin-main" className="admin-main">
          {children}
        </main>
      </div>
    </div>
  );
}
