import { useCallback, useEffect, useState, type ReactElement } from 'react';
import { adminApi } from '../../lib/admin-api';
import { appendCursor, startCursor, type CursorState } from '../../lib/cursor';
import { formatIsoUtc } from '../../lib/format';
import { Pager } from '../../components/admin/Pager';
import { AdminPage } from '../../components/admin/AdminPage';
import type { AdminSubscription } from '../../lib/admin-types';

const STATUSES = ['', 'trialing', 'active', 'past_due', 'paused', 'canceled'] as const;

export function Subscriptions(): ReactElement {
  const [status, setStatus] = useState<string>('');
  const [state, setState] = useState<CursorState<AdminSubscription> | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async (nextStatus: string) => {
    setLoading(true);
    setError(null);
    try {
      const page = await adminApi.listSubscriptions({
        ...(nextStatus.length > 0 ? { status: nextStatus } : {}),
      });
      setState(startCursor(page));
    } catch {
      setError('Could not load subscriptions.');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load(status);
  }, [status]);

  async function loadMore(): Promise<void> {
    if (state === null || state.nextCursor === null) return;
    setLoadingMore(true);
    try {
      const page = await adminApi.listSubscriptions({
        ...(status.length > 0 ? { status } : {}),
        cursor: state.nextCursor,
      });
      setState((prev) => (prev === null ? startCursor(page) : appendCursor(prev, page)));
    } catch {
      setError('Could not load more subscriptions.');
    } finally {
      setLoadingMore(false);
    }
  }

  return (
    <AdminPage
      documentTitle="Subscriptions | Admin"
      heading="Subscriptions"
      note="Billing state as written by the Paddle webhook. Paddle remains the source of truth, so a row here can lag a very recent change until its webhook is delivered."
    >
      <div className="admin-pills" role="group" aria-label="Filter by status">
        {STATUSES.map((s) => (
          <button
            key={s}
            type="button"
            className="admin-pill"
            aria-pressed={status === s}
            onClick={() => setStatus(s)}
          >
            {s.length === 0 ? 'All' : s}
          </button>
        ))}
      </div>

      {loading && <p>Loading…</p>}
      {error !== null && (
        <p role="alert" className="form-error">
          {error}
        </p>
      )}
      {!loading && state !== null && state.items.length === 0 && (
        <p className="admin-empty">No subscriptions found.</p>
      )}
      {!loading && state !== null && state.items.length > 0 && (
        <div className="admin-table-scroll">
          <table>
            <caption className="visually-hidden-status">Subscriptions</caption>
            <thead>
              <tr>
                <th scope="col">Organization</th>
                <th scope="col">Plan</th>
                <th scope="col">Status</th>
                <th scope="col">Cancels at period end</th>
                <th scope="col">Period end</th>
              </tr>
            </thead>
            <tbody>
              {state.items.map((sub) => (
                <tr key={sub.id}>
                  <td>{sub.organizationId}</td>
                  <td>{sub.plan}</td>
                  <td>{sub.status}</td>
                  <td>{sub.cancelAtPeriodEnd === 1 ? 'Yes' : 'No'}</td>
                  <td>{formatIsoUtc(sub.currentPeriodEndAt)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <Pager
        nextCursor={state?.nextCursor ?? null}
        loading={loadingMore}
        onLoadMore={() => void loadMore()}
      />
    </AdminPage>
  );
}
