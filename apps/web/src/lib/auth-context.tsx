import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactElement,
  type ReactNode,
} from 'react';

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
  const body = JSON.parse(text) as GetSessionResponse;
  if (body.user === null || body.session === null) return null;
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

  const refresh = useCallback(async () => {
    setLoading(true);
    try {
      const nextUser = await fetchSession();
      setUser(nextUser);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void refresh();
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
