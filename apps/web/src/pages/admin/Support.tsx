import { useCallback, useEffect, useState, type ReactElement } from 'react';
import { useSearchParams } from 'react-router';
import { adminApi } from '../../lib/admin-api';
import { appendCursor, startCursor, type CursorState } from '../../lib/cursor';
import { formatIsoUtc } from '../../lib/format';
import { Pager } from '../../components/admin/Pager';
import type { AdminSupportNote } from '../../lib/admin-types';

export function Support(): ReactElement {
  const [searchParams] = useSearchParams();
  const [organizationId, setOrganizationId] = useState(searchParams.get('organizationId') ?? '');
  const [notes, setNotes] = useState<CursorState<AdminSupportNote> | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [newNote, setNewNote] = useState('');
  const [statusMessage, setStatusMessage] = useState<string | null>(null);
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
      setStatusMessage('Note added.');
      await load(organizationId);
    } catch {
      setStatusMessage('Could not add note.');
    } finally {
      setSaving(false);
    }
  }

  return (
    <>
      <title>Support notes — Admin</title>
      <h1>Support notes</h1>
      <form
        className="form-field inline"
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

      <p role="status" aria-live="polite" className="visually-hidden-status">
        {statusMessage}
      </p>
      {loading && <p>Loading…</p>}
      {error !== null && (
        <p role="alert" className="form-error">
          {error}
        </p>
      )}
      {notes !== null && notes.items.length === 0 && <p>No support notes for this organization.</p>}
      {notes !== null && notes.items.length > 0 && (
        <>
          <ul>
            {notes.items.map((note) => (
              <li key={note.id}>
                <p>{note.body}</p>
                <p className="hint">
                  {formatIsoUtc(note.createdAt)} — author {note.authorUserId}
                </p>
              </li>
            ))}
          </ul>
          <Pager nextCursor={notes.nextCursor} loading={false} onLoadMore={() => void loadMore()} />
        </>
      )}

      <section>
        <h2>Add a note</h2>
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
    </>
  );
}
