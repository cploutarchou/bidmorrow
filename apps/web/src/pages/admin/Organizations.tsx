import { useCallback, useEffect, useState, type ReactElement } from 'react';
import { Link } from 'react-router';
import { adminApi } from '../../lib/admin-api';
import { appendCursor, startCursor, type CursorState } from '../../lib/cursor';
import { formatIsoUtc } from '../../lib/format';
import { Pager } from '../../components/admin/Pager';
import { AdminPage } from '../../components/admin/AdminPage';
import type { AdminOrgSummary } from '../../lib/admin-types';

export function Organizations(): ReactElement {
  const [query, setQuery] = useState('');
  const [state, setState] = useState<CursorState<AdminOrgSummary> | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async (nextQuery: string) => {
    setLoading(true);
    setError(null);
    try {
      const page = await adminApi.searchOrgs({ query: nextQuery });
      setState(startCursor(page));
    } catch {
      setError('Could not load organizations.');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load('');
  }, [load]);

  async function loadMore(): Promise<void> {
    if (state === null || state.nextCursor === null) return;
    setLoadingMore(true);
    try {
      const page = await adminApi.searchOrgs({ query, cursor: state.nextCursor });
      setState((prev) => (prev === null ? startCursor(page) : appendCursor(prev, page)));
    } catch {
      setError('Could not load more organizations.');
    } finally {
      setLoadingMore(false);
    }
  }

  return (
    <AdminPage
      documentTitle="Organizations — Admin"
      heading="Organizations"
      note="Every organization on the platform. Selecting one opens its detail view, which is where suspension lives — nothing on this page mutates anything."
    >
      <form
        className="admin-search"
        onSubmit={(event) => {
          event.preventDefault();
          void load(query);
        }}
      >
        <label htmlFor="org-search">Search by name</label>
        <input id="org-search" value={query} onChange={(event) => setQuery(event.target.value)} />
        <button type="submit">Search</button>
      </form>

      {loading && <p>Loading…</p>}
      {error !== null && (
        <p role="alert" className="form-error">
          {error}
        </p>
      )}
      {!loading && state !== null && state.items.length === 0 && (
        <p className="admin-empty">No organizations found.</p>
      )}
      {!loading && state !== null && state.items.length > 0 && (
        <div className="admin-table-scroll">
          <table>
            <caption className="visually-hidden-status">Organizations</caption>
            <thead>
              <tr>
                <th scope="col">Name</th>
                <th scope="col">Status</th>
                <th scope="col">Plan</th>
                <th scope="col">Subscription status</th>
                <th scope="col">Members</th>
              </tr>
            </thead>
            <tbody>
              {state.items.map((org) => (
                <tr key={org.id}>
                  <td>
                    <Link to={`/admin/orgs/${org.id}`}>{org.name}</Link>
                  </td>
                  <td>
                    {org.suspendedAt !== null
                      ? `SUSPENDED (since ${formatIsoUtc(org.suspendedAt)})`
                      : org.status}
                  </td>
                  <td>{org.subscription?.plan ?? '—'}</td>
                  <td>{org.subscription?.status ?? '—'}</td>
                  <td>{org.memberCount}</td>
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
