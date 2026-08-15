import type { ReactElement, ReactNode } from 'react';
import { Link } from 'react-router';

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
 * Plain, dense internal-tooling shell — deliberately distinct from the
 * customer `AppShell` (no marketing chrome, no branding emphasis). Never a
 * security boundary: reachability here already implies the
 * `/api/admin/health-details` probe succeeded (`AdminGate`), and every page
 * still gets its data solely from the server, which independently
 * authorizes every request.
 */
export function AdminShell({ children }: { children: ReactNode }): ReactElement {
  return (
    <div className="admin-shell">
      <a className="skip-link" href="#admin-main">
        Skip to main content
      </a>
      <header className="admin-header">
        <p className="admin-header__title">BidMorrow — Internal Admin</p>
        <nav aria-label="Admin sections">
          <ul className="admin-nav">
            {ADMIN_NAV.map((item) => (
              <li key={item.to}>
                <Link to={item.to}>{item.label}</Link>
              </li>
            ))}
          </ul>
        </nav>
        <p className="admin-header__note">
          Internal ops tooling — not a customer surface. Every request here is audited.
        </p>
      </header>
      <main id="admin-main" className="admin-main">
        {children}
      </main>
    </div>
  );
}
