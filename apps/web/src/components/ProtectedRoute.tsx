import type { ReactElement, ReactNode } from 'react';
import { Navigate, useLocation } from 'react-router';
import { useAuth } from '../lib/auth-context';

/**
 * Client-side route guard for UX only, never a security boundary (the
 * server independently enforces auth/authorization on every API call;
 * .claude/agents/frontend.md "never embed role/organization logic
 * client-side as a security mechanism"). Redirects to /login when there is
 * no session so an unauthenticated visitor doesn't see a broken app shell.
 *
 * R4 (docs/redesign/ux-strategy.md §1.3): carries the page the visitor was
 * trying to reach as `?returnTo=`, so a session that expired mid-visit (the
 * digest email's main re-engagement path) survives a fresh login; `Login`
 * honors it via `resolvePostAuthDestination`.
 */
export function ProtectedRoute({ children }: { children: ReactNode }): ReactElement {
  const { user, loading } = useAuth();
  const location = useLocation();

  if (loading) {
    return (
      <main id="main-content">
        <p>Loading…</p>
      </main>
    );
  }

  if (user === null) {
    const returnTo = `${location.pathname}${location.search}`;
    return <Navigate to={`/login?returnTo=${encodeURIComponent(returnTo)}`} replace />;
  }

  return <>{children}</>;
}
