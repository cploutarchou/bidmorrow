import '../../styles/admin.css';
import type { ReactElement, ReactNode } from 'react';
import { Link, useLocation } from 'react-router';
import type { AdminRailCounts } from '../../lib/admin-types';
import { ThemeToggle } from '../ThemeToggle';
import { NoIndex } from '../NoIndex';
import { useAdminOps } from './admin-health';

const ADMIN_NAV: { to: string; label: string; countKey?: keyof AdminRailCounts }[] = [
  { to: '/admin', label: 'Dashboard' },
  { to: '/admin/orgs', label: 'Organizations', countKey: 'organizations' },
  { to: '/admin/users', label: 'Users', countKey: 'users' },
  { to: '/admin/subscriptions', label: 'Subscriptions', countKey: 'subscriptions' },
  { to: '/admin/ingestion', label: 'Ingestion', countKey: 'ingestionRuns' },
  { to: '/admin/matching', label: 'Matching' },
  { to: '/admin/digest', label: 'Digest', countKey: 'digestRuns' },
  { to: '/admin/support', label: 'Support', countKey: 'supportNotes' },
  { to: '/admin/audit', label: 'Audit', countKey: 'auditEvents' },
  { to: '/admin/flags', label: 'Flags', countKey: 'flags' },
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
  const ops = useAdminOps();
  const health = ops?.health ?? null;
  const railCounts = ops?.railCounts ?? null;

  function isCurrent(to: string): boolean {
    if (to === '/admin') return location.pathname === '/admin';
    return location.pathname === to || location.pathname.startsWith(`${to}/`);
  }

  return (
    <div className="admin-shell">
      <NoIndex />
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
          {/* Ops pills (prototype header): live pause state from the same
              health-details response that authorized the surface. The
              prototype's third pill (audit-event count) lives in the rail
              instead — one source, not two. */}
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
          <ThemeToggle />
        </div>
      </header>
      <div className="admin-split">
        <nav aria-label="Admin sections" className="admin-rail">
          {ADMIN_NAV.map((item) => (
            <Link key={item.to} to={item.to} aria-current={isCurrent(item.to) ? 'page' : undefined}>
              {item.label}
              {railCounts !== null && item.countKey !== undefined && (
                <span className="admin-rail__count num">{railCounts[item.countKey]}</span>
              )}
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
