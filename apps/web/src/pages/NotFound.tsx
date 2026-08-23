import type { ReactElement } from 'react';
import { Link } from 'react-router';
import { NoIndex } from '../components/NoIndex';

/**
 * Generic 404 page — also what `AdminGate` renders when the
 * `/api/admin/health-details` probe 404s, so a non-admin visiting `/admin/*`
 * sees exactly the same page as any other unknown route (the admin surface's
 * existence is never revealed client-side, mirroring
 * apps/worker/src/middleware/admin.ts's server-side cloaking).
 */
export function NotFound(): ReactElement {
  return (
    <main id="main-content">
      <title>Page not found — BidMorrow</title>
      <NoIndex />
      <h1>Page not found</h1>
      <p>The page you're looking for doesn't exist.</p>
      <p>
        <Link to="/">Return home</Link>
      </p>
    </main>
  );
}
