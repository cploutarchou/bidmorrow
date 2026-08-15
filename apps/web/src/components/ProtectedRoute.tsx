import type { ReactElement, ReactNode } from 'react';
import { Navigate } from 'react-router';
import { useAuth } from '../lib/auth-context';

/**
 * Client-side route guard for UX only — never a security boundary (the
 * server independently enforces auth/authorization on every API call;
 * .claude/agents/frontend.md "never embed role/organization logic
 * client-side as a security mechanism"). Redirects to /login when there is
 * no session so an unauthenticated visitor doesn't see a broken app shell.
 */
export function ProtectedRoute({ children }: { children: ReactNode }): ReactElement {
  const { user, loading } = useAuth();

  if (loading) {
    return (
      <main id="main-content">
        <p>Loading…</p>
      </main>
    );
  }

  if (user === null) {
    return <Navigate to="/login" replace />;
  }

  return <>{children}</>;
}
