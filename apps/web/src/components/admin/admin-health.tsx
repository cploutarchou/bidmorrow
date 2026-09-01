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
import { adminApi } from '../../lib/admin-api';
import type { AdminHealthDetails, AdminRailCounts } from '../../lib/admin-types';

/**
 * Shared admin operational state: one `health-details` response (the one
 * `AdminGate` already made to authorize the surface, re-used rather than
 * re-fetched) plus the rail counts. Consumers: the shell's ops pills and
 * rail counts, and the Ingestion/Digest pause controls, which call
 * `refresh()` after a successful pause/resume so the pills flip without a
 * reload. Everything here is presentation state; the server independently
 * authorizes every request regardless of what this renders.
 */
export interface AdminOpsState {
  readonly health: AdminHealthDetails | null;
  readonly railCounts: AdminRailCounts | null;
  readonly refresh: () => Promise<void>;
}

const AdminOpsContext = createContext<AdminOpsState | null>(null);

export function AdminOpsProvider({
  initialHealth,
  children,
}: {
  initialHealth: AdminHealthDetails;
  children: ReactNode;
}): ReactElement {
  const [health, setHealth] = useState<AdminHealthDetails | null>(initialHealth);
  const [railCounts, setRailCounts] = useState<AdminRailCounts | null>(null);

  // Rail counts load once behind the gate, best-effort: the rail renders
  // without counts if this fails.
  useEffect(() => {
    let cancelled = false;
    adminApi
      .railCounts()
      .then((counts) => {
        if (!cancelled) setRailCounts(counts);
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, []);

  const refresh = useCallback(async () => {
    // Best-effort on both calls: a failed refresh keeps the last known
    // values (slightly stale pills) rather than blanking the shell.
    try {
      setHealth(await adminApi.healthDetails());
    } catch {
      /* keep previous */
    }
    try {
      setRailCounts(await adminApi.railCounts());
    } catch {
      /* keep previous */
    }
  }, []);

  const value = useMemo(() => ({ health, railCounts, refresh }), [health, railCounts, refresh]);
  return <AdminOpsContext.Provider value={value}>{children}</AdminOpsContext.Provider>;
}

export function useAdminOps(): AdminOpsState | null {
  return useContext(AdminOpsContext);
}
