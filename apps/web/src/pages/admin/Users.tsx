import { useCallback, useEffect, useState, type ReactElement } from 'react';
import { adminApi } from '../../lib/admin-api';
import { appendCursor, startCursor, type CursorState } from '../../lib/cursor';
import { Pager } from '../../components/admin/Pager';
import { AdminPage } from '../../components/admin/AdminPage';
import type { AdminUserSummary } from '../../lib/admin-types';

export function Users(): ReactElement {
  const [query, setQuery] = useState('');
  const [state, setState] = useState<CursorState<AdminUserSummary> | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async (nextQuery: string) => {
    setLoading(true);
    setError(null);
    try {
      const page = await adminApi.searchUsers({ query: nextQuery });
      setState(startCursor(page));
    } catch {
      setError('Could not load users.');
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
      const page = await adminApi.searchUsers({ query, cursor: state.nextCursor });
      setState((prev) => (prev === null ? startCursor(page) : appendCursor(prev, page)));
    } catch {
      setError('Could not load more users.');
    } finally {
      setLoadingMore(false);
    }
  }

  return (
    <AdminPage
      documentTitle="Users — Admin"
      heading="Users"
      note="Accounts across every organization, with the organizations each one belongs to. Read-only: user records cannot be edited from the admin surface."
    >
      <form
        className="admin-search"
        onSubmit={(event) => {
          event.preventDefault();
          void load(query);
        }}
      >
        <label htmlFor="user-search">Search by email</label>
        <input id="user-search" value={query} onChange={(event) => setQuery(event.target.value)} />
        <button type="submit">Search</button>
      </form>

      {loading && <p>Loading…</p>}
      {error !== null && (
        <p role="alert" className="form-error">
          {error}
        </p>
      )}
      {!loading && state !== null && state.items.length === 0 && (
        <p className="admin-empty">No users found.</p>
      )}
      {!loading && state !== null && state.items.length > 0 && (
        <div className="admin-table-scroll">
          <table>
            <caption className="visually-hidden-status">Users</caption>
            <thead>
              <tr>
                <th scope="col">Email</th>
                <th scope="col">Verified</th>
                <th scope="col">Organizations</th>
              </tr>
            </thead>
            <tbody>
              {state.items.map((user) => (
                <tr key={user.id}>
                  <td>{user.email}</td>
                  <td>{user.emailVerified ? 'Yes' : 'No'}</td>
                  <td>
                    {user.organizationIds.length === 0 ? '—' : user.organizationIds.join(', ')}
                  </td>
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
