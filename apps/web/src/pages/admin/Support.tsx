import { useCallback, useEffect, useState, type ReactElement } from 'react';
import { useSearchParams } from 'react-router';
import { adminApi } from '../../lib/admin-api';
import { appendCursor, startCursor, type CursorState } from '../../lib/cursor';
import { formatIsoUtc } from '../../lib/format';
import { Pager } from '../../components/admin/Pager';
import { AdminPage } from '../../components/admin/AdminPage';
import { AdminFlash } from '../../components/admin/AdminFlash';
import type { AdminSupportNote } from '../../lib/admin-types';

export function Support(): ReactElement {
  const [searchParams] = useSearchParams();
  const [organizationId, setOrganizationId] = useState(searchParams.get('organizationId') ?? '');
  const [notes, setNotes] = useState<CursorState<AdminSupportNote> | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [newNote, setNewNote] = useState('');
  const [statusMessage, setStatusMessage] = useState<string | null>(null);
  const [flashTone, setFlashTone] = useState<'ok' | 'risk'>('ok');
  const [saving, setSaving] = useState(false);

  const load = useCallback(async (orgId: string) => {
    if (orgId.trim().length === 0) {
      setNotes(null);
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const page = await adminApi.listSupportNotes({ organizationId: orgId.trim() });
      setNotes(startCursor(page));
    } catch {
      setError('Could not load support notes.');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load(organizationId);
    // Only re-runs from the initial query-string value; explicit form submit drives further loads.
  }, []);

  async function loadMore(): Promise<void> {
    if (notes === null || notes.nextCursor === null) return;
    try {
      const page = await adminApi.listSupportNotes({
        organizationId: organizationId.trim(),
        cursor: notes.nextCursor,
      });
      setNotes((prev) => (prev === null ? startCursor(page) : appendCursor(prev, page)));
    } catch {
      setError('Could not load more notes.');
    }
  }

  async function addNote(): Promise<void> {
    if (organizationId.trim().length === 0 || newNote.trim().length === 0) return;
    setSaving(true);
    setStatusMessage(null);
    try {
      await adminApi.addSupportNote({
        organizationId: organizationId.trim(),
        body: newNote.trim(),
      });
      setNewNote('');
      setFlashTone('ok');
      setStatusMessage('Note added.');
      await load(organizationId);
    } catch {
      setFlashTone('risk');
      setStatusMessage('Could not add note.');
    } finally {
      setSaving(false);
    }
  }

  return (
    <AdminPage
      documentTitle="Support notes | Admin"
      heading="Support notes"
      note="Internal notes attached to one organization. Customers never see these, and they are scoped to the organization ID you load. Nothing is listed globally."
    >
      <form
        className="form-field inline admin-filters"
        onSubmit={(event) => {
          event.preventDefault();
          void load(organizationId);
        }}
      >
        <label htmlFor="support-org">Organization ID</label>
        <input
          id="support-org"
          value={organizationId}
          onChange={(event) => setOrganizationId(event.target.value)}
        />
        <button type="submit">Load notes</button>
      </form>

      <AdminFlash message={statusMessage} tone={flashTone} />
      {loading && <p>Loading…</p>}
      {error !== null && (
        <p role="alert" className="form-error">
          {error}
        </p>
      )}
      {notes !== null && notes.items.length === 0 && (
        <p className="admin-empty">No support notes for this organization.</p>
      )}
      {notes !== null && notes.items.length > 0 && (
        <>
          <ul className="admin-notes">
            {notes.items.map((note) => (
              <li key={note.id} className="admin-note">
                <p className="admin-note__body">{note.body}</p>
                <p className="admin-note__meta">
                  {formatIsoUtc(note.createdAt)}, author {note.authorUserId}
                </p>
              </li>
            ))}
          </ul>
          <Pager nextCursor={notes.nextCursor} loading={false} onLoadMore={() => void loadMore()} />
        </>
      )}

      <section className="admin-panel">
        <h2 className="admin-panel__label">Add a note</h2>
        <div className="form-field">
          <label htmlFor="new-note">Note</label>
          <textarea
            id="new-note"
            value={newNote}
            onChange={(event) => setNewNote(event.target.value)}
          />
        </div>
        <button
          className="cta"
          type="button"
          disabled={saving || organizationId.trim().length === 0 || newNote.trim().length === 0}
          onClick={() => void addNote()}
        >
          {saving ? 'Saving…' : 'Add note'}
        </button>
      </section>
    </AdminPage>
  );
}
