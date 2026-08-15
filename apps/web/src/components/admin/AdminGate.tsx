import { useEffect, useState, type ReactElement } from 'react';
import { Outlet } from 'react-router';
import { adminApi } from '../../lib/admin-api';
import { NotFound } from '../../pages/NotFound';
import { AdminShell } from './AdminShell';

type GateState = 'loading' | 'authorized' | 'denied';

/**
 * Access probe for the entire `/admin/*` subtree: calls
 * `GET /api/admin/health-details` once on mount. A 404 (or any other
 * failure) renders the app's normal `NotFound` page — the admin surface is
 * never revealed to a caller who cannot use it, mirroring the server's own
 * cloaking (apps/worker/src/middleware/admin.ts always 404s a non-admin,
 * including an unauthenticated visitor). This is UX only: the server
 * independently authorizes every `/api/admin/*` call the pages below make.
 */
export function AdminGate(): ReactElement {
  const [state, setState] = useState<GateState>('loading');

  useEffect(() => {
    let cancelled = false;
    adminApi
      .healthDetails()
      .then(() => {
        if (!cancelled) setState('authorized');
      })
      .catch(() => {
        if (!cancelled) setState('denied');
      });
    return () => {
      cancelled = true;
    };
  }, []);

  if (state === 'loading') {
    return (
      <main id="main-content">
        <p>Loading…</p>
      </main>
    );
  }

  if (state === 'denied') {
    return <NotFound />;
  }

  return (
    <AdminShell>
      <Outlet />
    </AdminShell>
  );
}
