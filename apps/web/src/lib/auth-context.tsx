import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactElement,
  type ReactNode,
} from 'react';
import { setUnauthorizedHandler } from './api';

export interface SessionUser {
  id: string;
  email: string;
  emailVerified: boolean;
  name: string | null;
}

interface GetSessionResponse {
  session: { id: string } | null;
  user: {
    id: string;
    email: string;
    emailVerified: boolean;
    name?: string | null;
  } | null;
}

interface AuthContextValue {
  user: SessionUser | null;
  loading: boolean;
  /** Re-fetches `/api/auth/get-session` (call after sign-in/out or profile changes). */
  refresh: () => Promise<void>;
}

const AuthContext = createContext<AuthContextValue | null>(null);

async function fetchSession(): Promise<SessionUser | null> {
  const response = await fetch('/api/auth/get-session', { credentials: 'include' });
  if (!response.ok) return null;
  const text = await response.text();
  if (text.length === 0) return null;
  // Better Auth returns a bare JSON `null` body (not `{user: null}`) when
  // there is no session — e.g. immediately after sign-out.
  const body = JSON.parse(text) as GetSessionResponse | null;
  if (body === null || body.user === null || body.session === null) return null;
  return {
    id: body.user.id,
    email: body.user.email,
    emailVerified: body.user.emailVerified,
    name: body.user.name ?? null,
  };
}

export function AuthProvider({ children }: { children: ReactNode }): ReactElement {
  const [user, setUser] = useState<SessionUser | null>(null);
  const [loading, setLoading] = useState(true);
  // Always holds the latest `user` for the 401 handler below, which is
  // registered once (empty dep array beyond `refresh`) and must not close
  // over a stale value.
  const userRef = useRef<SessionUser | null>(null);
  userRef.current = user;
  // Coalesces concurrent `refresh()` callers into one in-flight request —
  // e.g. several app-page fetches all 401'ing at once when a session
  // expires mid-use would otherwise each kick off their own
  // `/api/auth/get-session` round trip.
  const inFlightRef = useRef<Promise<void> | null>(null);

  const refresh = useCallback(async () => {
    if (inFlightRef.current !== null) return inFlightRef.current;
    const run = (async () => {
      setLoading(true);
      try {
        const nextUser = await fetchSession();
        setUser(nextUser);
      } finally {
        setLoading(false);
        inFlightRef.current = null;
      }
    })();
    inFlightRef.current = run;
    return run;
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  useEffect(() => {
    // The shared point where an app API 401 (session expired/revoked
    // mid-use) re-syncs auth state (lib/api.ts). Re-fetching
    // `/api/auth/get-session` happens via `fetchSession()` directly, never
    // through `api.*`, so this can never trigger itself — no loop. Once
    // `user` is already null there is nothing left to resync, so further
    // 401s (e.g. several stragglers from the page the user was on when the
    // session died) are no-ops; `ProtectedRoute` reacts to `user` becoming
    // null and redirects to `/login?returnTo=...`.
    setUnauthorizedHandler(() => {
      if (userRef.current === null) return;
      void refresh();
    });
    return () => setUnauthorizedHandler(null);
  }, [refresh]);

  const value = useMemo<AuthContextValue>(
    () => ({ user, loading, refresh }),
    [user, loading, refresh],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext);
  if (ctx === null) throw new Error('useAuth must be used within an AuthProvider');
  return ctx;
}
