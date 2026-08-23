import { useCallback, useEffect, useState, type ReactElement } from 'react';
import { adminApi } from '../../lib/admin-api';
import { appendCursor, startCursor, type CursorState } from '../../lib/cursor';
import { formatIsoUtc } from '../../lib/format';
import { Pager } from '../../components/admin/Pager';
import { AdminPage } from '../../components/admin/AdminPage';
import type { AdminAuditEvent } from '../../lib/admin-types';

export function Audit(): ReactElement {
  const [actorId, setActorId] = useState('');
  const [action, setAction] = useState('');
  const [since, setSince] = useState('');
  const [events, setEvents] = useState<CursorState<AdminAuditEvent> | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const filters = useCallback(
    () => ({
      ...(actorId.trim().length > 0 ? { actorId: actorId.trim() } : {}),
      ...(action.trim().length > 0 ? { action: action.trim() } : {}),
      ...(since.length > 0 ? { sinceMs: String(Date.parse(`${since}T00:00:00Z`)) } : {}),
    }),
    [actorId, action, since],
  );

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const page = await adminApi.listAuditEvents(filters());
      setEvents(startCursor(page));
    } catch {
      setError('Could not load audit events.');
    } finally {
      setLoading(false);
    }
  }, [filters]);

  useEffect(() => {
    void load();
    // Filters apply on explicit submit, consistent with the Feed filter-bar pattern.
  }, []);

  async function loadMore(): Promise<void> {
    if (events === null || events.nextCursor === null) return;
    try {
      const page = await adminApi.listAuditEvents({ ...filters(), cursor: events.nextCursor });
      setEvents((prev) => (prev === null ? startCursor(page) : appendCursor(prev, page)));
    } catch {
      setError('Could not load more audit events.');
    }
  }

  return (
    <AdminPage
      documentTitle="Audit — Admin"
      heading="Audit events"
      note="Every admin action lands here, including the ones that failed. Filters apply when submitted, not as you type."
    >
      <form
        className="filter-bar admin-filters"
        onSubmit={(event) => {
          event.preventDefault();
          void load();
        }}
      >
        <div className="form-field">
          <label htmlFor="audit-actor">Actor (user) ID</label>
          <input
            id="audit-actor"
            value={actorId}
            onChange={(event) => setActorId(event.target.value)}
          />
        </div>
        <div className="form-field">
          <label htmlFor="audit-action">Action</label>
          <input
            id="audit-action"
            value={action}
            onChange={(event) => setAction(event.target.value)}
          />
        </div>
        <div className="form-field">
          <label htmlFor="audit-since">Since date</label>
          <input
            id="audit-since"
            type="date"
            value={since}
            onChange={(event) => setSince(event.target.value)}
          />
        </div>
        <button className="cta" type="submit">
          Apply filters
        </button>
      </form>

      {loading && <p>Loading…</p>}
      {error !== null && (
        <p role="alert" className="form-error">
          {error}
        </p>
      )}
      {!loading && events !== null && events.items.length === 0 && (
        <p className="admin-empty">No audit events found.</p>
      )}
      {!loading && events !== null && events.items.length > 0 && (
        <>
          <div className="admin-table-scroll">
            <table>
              <caption className="visually-hidden-status">Audit events</caption>
              <thead>
                <tr>
                  <th scope="col">Occurred</th>
                  <th scope="col">Actor</th>
                  <th scope="col">Action</th>
                  <th scope="col">Target</th>
                  <th scope="col">Organization</th>
                  <th scope="col">Before / After</th>
                </tr>
              </thead>
              <tbody>
                {events.items.map((event) => (
                  <tr key={event.id}>
                    <td>{formatIsoUtc(event.occurredAt)}</td>
                    <td>
                      {event.actorType}
                      {event.actorId !== null ? ` (${event.actorId})` : ''}
                    </td>
                    <td>{event.action}</td>
                    <td>
                      {event.targetType}
                      {event.targetId !== null ? ` (${event.targetId})` : ''}
                    </td>
                    <td>{event.organizationId ?? '—'}</td>
                    <td>
                      {event.beforeSummary ?? '—'} / {event.afterSummary ?? '—'}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <Pager
            nextCursor={events.nextCursor}
            loading={false}
            onLoadMore={() => void loadMore()}
          />
        </>
      )}
    </AdminPage>
  );
}
