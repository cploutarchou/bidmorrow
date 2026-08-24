import { useCallback, useEffect, useState, type ReactElement } from 'react';
import { adminApi } from '../../lib/admin-api';
import { formatIsoUtc } from '../../lib/format';
import { ConfirmAction } from '../../components/admin/ConfirmAction';
import { AdminPage } from '../../components/admin/AdminPage';
import { AdminFlash } from '../../components/admin/AdminFlash';
import type { AdminFlag } from '../../lib/admin-types';

export function Flags(): ReactElement {
  const [flags, setFlags] = useState<AdminFlag[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [editingKey, setEditingKey] = useState<string | null>(null);
  const [editValue, setEditValue] = useState('');
  const [editDescription, setEditDescription] = useState('');
  const [busy, setBusy] = useState(false);
  const [statusMessage, setStatusMessage] = useState<string | null>(null);
  // Tone is tracked next to the message so a failure is not shown in the
  // same affirmative styling as a success.
  const [flashTone, setFlashTone] = useState<'ok' | 'risk'>('ok');

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const result = await adminApi.listFlags();
      setFlags(result.items);
    } catch {
      setError('Could not load feature flags.');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  function startEdit(flag: AdminFlag): void {
    setEditingKey(flag.key);
    setEditValue(flag.value ?? '');
    setEditDescription(flag.description ?? '');
  }

  const editValueIsValidJson = ((): boolean => {
    try {
      JSON.parse(editValue);
      return true;
    } catch {
      return false;
    }
  })();

  async function saveEdit(): Promise<void> {
    if (editingKey === null) return;
    let parsedValue: unknown;
    try {
      parsedValue = JSON.parse(editValue);
    } catch {
      setFlashTone('risk');
      setStatusMessage('Value must be valid JSON (e.g. "true", "42", or a quoted string).');
      return;
    }
    setBusy(true);
    setStatusMessage(null);
    try {
      await adminApi.updateFlag(editingKey, {
        value: parsedValue,
        ...(editDescription.trim().length > 0 ? { description: editDescription.trim() } : {}),
      });
      setFlashTone('ok');
      setStatusMessage(`Flag ${editingKey} updated.`);
      setEditingKey(null);
      await load();
    } catch {
      setFlashTone('risk');
      setStatusMessage('Could not update flag.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <AdminPage
      documentTitle="Feature flags — Admin"
      heading="Feature flags"
      note="Operational switches read by the server at runtime. Every change is typed-confirmed and written to the audit log."
    >
      <AdminFlash message={statusMessage} tone={flashTone} />
      {loading && <p>Loading…</p>}
      {error !== null && (
        <p role="alert" className="form-error">
          {error}
        </p>
      )}
      {!loading && flags.length > 0 && (
        <div className="admin-table-scroll">
          <table>
            <caption className="visually-hidden-status">Feature flags</caption>
            <thead>
              <tr>
                <th scope="col">Key</th>
                <th scope="col">Value</th>
                <th scope="col">Description</th>
                <th scope="col">Updated</th>
                <th scope="col">Edit</th>
              </tr>
            </thead>
            <tbody>
              {flags.map((flag) => (
                <tr key={flag.key}>
                  <td>{flag.key}</td>
                  <td>{flag.value ?? '(unset)'}</td>
                  <td>{flag.description ?? '—'}</td>
                  <td>{formatIsoUtc(flag.updatedAt)}</td>
                  <td>
                    <button type="button" onClick={() => startEdit(flag)}>
                      Edit
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {editingKey !== null && (
        <section className="admin-panel">
          <h2 className="admin-panel__label">Editing {editingKey}</h2>
          <div className="form-field">
            <label htmlFor="flag-value">Value (JSON)</label>
            <input
              id="flag-value"
              value={editValue}
              aria-invalid={!editValueIsValidJson}
              aria-describedby="flag-value-hint"
              onChange={(event) => setEditValue(event.target.value)}
            />
            {/* Live validity readout (prototype's flag hint) — the same
                JSON.parse gate saveEdit enforces, surfaced per keystroke so
                the typed confirmation is never spent on a doomed value. */}
            <p
              id="flag-value-hint"
              className={editValueIsValidJson ? 'hint admin-tone-ok' : 'hint admin-tone-risk'}
            >
              {editValueIsValidJson
                ? 'Valid JSON literal.'
                : 'Value must be valid JSON (e.g. true, 42, or a quoted string).'}
            </p>
          </div>
          <div className="form-field">
            <label htmlFor="flag-description">Description</label>
            <input
              id="flag-description"
              value={editDescription}
              onChange={(event) => setEditDescription(event.target.value)}
            />
          </div>
          <div className="button-row">
            <ConfirmAction
              label="Update flag"
              confirmText="UPDATE_FLAG"
              consequence="Takes effect on the next request that reads this flag — there is no staged rollout."
              busy={busy}
              variant="danger"
              onConfirm={() => void saveEdit()}
            />
            {/* Renamed from "Cancel": the armed confirm strip has its own
                Cancel now, and two identically-labeled buttons with
                different effects would be ambiguous. */}
            <button type="button" onClick={() => setEditingKey(null)}>
              Close editor
            </button>
          </div>
        </section>
      )}
    </AdminPage>
  );
}
