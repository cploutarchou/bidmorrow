import type { ReactElement, ReactNode } from 'react';
import { Link, useLocation } from 'react-router';
import { ThemeToggle } from '../ThemeToggle';

const ADMIN_NAV: { to: string; label: string }[] = [
  { to: '/admin', label: 'Dashboard' },
  { to: '/admin/orgs', label: 'Organizations' },
  { to: '/admin/users', label: 'Users' },
  { to: '/admin/subscriptions', label: 'Subscriptions' },
  { to: '/admin/ingestion', label: 'Ingestion' },
  { to: '/admin/matching', label: 'Matching' },
  { to: '/admin/digest', label: 'Digest' },
  { to: '/admin/support', label: 'Support' },
  { to: '/admin/audit', label: 'Audit' },
  { to: '/admin/flags', label: 'Flags' },
];

/**
 * Internal-tooling shell — 2026-08-21 handoff redesign (`BidMorrow
 * Admin.dc.html`): header strip with the audited-surface note, and a
 * sticky left section rail with a left-mark active state, replacing the
 * old horizontal top nav. Deliberately distinct from the customer
 * `AppShell`. Never a security boundary: reachability here already
 * implies the `/api/admin/health-details` probe succeeded (`AdminGate`),
 * and every page still gets its data solely from the server, which
 * independently authorizes every request.
 */
export function AdminShell({ children }: { children: ReactNode }): ReactElement {
  const location = useLocation();

  function isCurrent(to: string): boolean {
    if (to === '/admin') return location.pathname === '/admin';
    return location.pathname === to || location.pathname.startsWith(`${to}/`);
  }

  return (
    <div className="admin-shell">
      <a className="skip-link" href="#admin-main">
        Skip to main content
      </a>
      <header className="admin-header">
        <div className="admin-header__id">
          <p className="admin-header__title">BidMorrow — Internal Admin</p>
          <p className="admin-header__note">
            Internal ops tooling — not a customer surface. Every request here is audited.
          </p>
        </div>
        <div className="admin-header__actions">
          <ThemeToggle />
        </div>
      </header>
      <div className="admin-split">
        <nav aria-label="Admin sections" className="admin-rail">
          {ADMIN_NAV.map((item) => (
            <Link key={item.to} to={item.to} aria-current={isCurrent(item.to) ? 'page' : undefined}>
              {item.label}
            </Link>
          ))}
        </nav>
        <main id="admin-main" className="admin-main">
          {children}
        </main>
      </div>
    </div>
  );
}
