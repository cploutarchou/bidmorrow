import { Component, type ErrorInfo, type ReactElement, type ReactNode } from 'react';

/**
 * Recovers from a stale-deploy chunk failure.
 *
 * Route code-splitting means navigation fetches a JS chunk by hashed name. The
 * Worker serves the SPA with `not_found_handling: "single-page-application"`,
 * so after a deploy a request for a chunk that no longer exists does NOT 404.
 * it returns `index.html` with HTTP 200 and `text/html`. The browser then fails
 * the dynamic import with a MIME/parse error, and the route renders nothing.
 *
 * A reload fixes it permanently (the fresh `index.html` references the new
 * chunk names), so that is what this does, once. The `sessionStorage` guard
 * is what stops a genuinely broken build from becoming a reload loop; if the
 * import fails again after reloading, the user gets a plain message instead.
 */

const RELOAD_GUARD_KEY = 'bm_chunk_reload';

/**
 * Chunk-load failures surface with different wording per browser, so match on
 * the shared substrings rather than any one engine's exact message.
 */
const CHUNK_ERROR_PATTERNS = [
  'dynamically imported module',
  'Importing a module script failed',
  'error loading dynamically imported module',
  'Loading chunk',
];

function isChunkLoadError(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error);
  return CHUNK_ERROR_PATTERNS.some((pattern) => message.includes(pattern));
}

/** sessionStorage throws in some privacy modes; a failure here must not mask the original error. */
function readGuard(): boolean {
  try {
    return sessionStorage.getItem(RELOAD_GUARD_KEY) !== null;
  } catch {
    return true; // Can't track attempts, so don't risk a loop.
  }
}

function writeGuard(): void {
  try {
    sessionStorage.setItem(RELOAD_GUARD_KEY, '1');
  } catch {
    /* see readGuard */
  }
}

interface State {
  readonly failed: boolean;
}

export class RouteChunkBoundary extends Component<{ children: ReactNode }, State> {
  override state: State = { failed: false };

  static getDerivedStateFromError(): State {
    return { failed: true };
  }

  override componentDidCatch(error: Error, _info: ErrorInfo): void {
    if (isChunkLoadError(error) && !readGuard()) {
      writeGuard();
      window.location.reload();
      return;
    }
    // Anything else is a real rendering bug; leave it visible rather than
    // reloading over it, which would hide the fault and lose the console trace.
    console.error(error);
  }

  override render(): ReactNode {
    if (!this.state.failed) return this.props.children;
    return (
      <main id="main-content">
        <h1>Something went wrong</h1>
        <p>
          This page didn't load. Reloading usually fixes it. If it keeps happening, contact{' '}
          <a href="mailto:support@bidmorrow.com">support@bidmorrow.com</a>.
        </p>
      </main>
    );
  }
}

/**
 * Clears the reload guard once the app has rendered successfully, so a future
 * deploy gets its own single retry rather than inheriting a spent one.
 */
export function clearChunkReloadGuard(): void {
  try {
    sessionStorage.removeItem(RELOAD_GUARD_KEY);
  } catch {
    /* see readGuard */
  }
}

export function RouteFallback(): ReactElement {
  // Same shape the codebase already uses for route-level waiting
  // (components/ProtectedRoute.tsx, components/admin/AdminGate.tsx).
  return (
    <main id="main-content">
      <p>Loading…</p>
    </main>
  );
}
