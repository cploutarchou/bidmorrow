import { useEffect, useState, type ReactElement } from 'react';
import { Outlet } from 'react-router';
import { adminApi } from '../../lib/admin-api';
import type { AdminHealthDetails } from '../../lib/admin-types';
import { NotFound } from '../../pages/NotFound';
import { AdminOpsProvider } from './admin-health';
import { AdminShell } from './AdminShell';

type GateState =
  { kind: 'loading' } | { kind: 'authorized'; health: AdminHealthDetails } | { kind: 'denied' };

/**
 * Access probe for the entire `/admin/*` subtree: calls
 * `GET /api/admin/health-details` once on mount. A 404 (or any other
 * failure) renders the app's normal `NotFound` page: the admin surface is
 * never revealed to a caller who cannot use it, mirroring the server's own
 * cloaking (apps/worker/src/middleware/admin.ts always 404s a non-admin,
 * including an unauthenticated visitor). This is UX only: the server
 * independently authorizes every `/api/admin/*` call the pages below make.
 */
export function AdminGate(): ReactElement {
  const [state, setState] = useState<GateState>({ kind: 'loading' });

  useEffect(() => {
    let cancelled = false;
    adminApi
      .healthDetails()
      .then((health) => {
        // The gate's own probe response seeds the shared ops state (pills,
        // pause-control state) instead of being thrown away and re-fetched.
        if (!cancelled) setState({ kind: 'authorized', health });
      })
      .catch(() => {
        if (!cancelled) setState({ kind: 'denied' });
      });
    return () => {
      cancelled = true;
    };
  }, []);

  if (state.kind === 'loading') {
    return (
      <main id="main-content">
        <p>Loading…</p>
      </main>
    );
  }

  if (state.kind === 'denied') {
    return <NotFound />;
  }

  return (
    <AdminOpsProvider initialHealth={state.health}>
      <AdminShell>
        <Outlet />
      </AdminShell>
    </AdminOpsProvider>
  );
}
