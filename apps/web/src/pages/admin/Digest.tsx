import { useCallback, useEffect, useState, type ReactElement } from 'react';
import { adminApi } from '../../lib/admin-api';
import { ApiError } from '../../lib/api';
import { appendCursor, startCursor, type CursorState } from '../../lib/cursor';
import { formatIsoUtc } from '../../lib/format';
import { ConfirmAction } from '../../components/admin/ConfirmAction';
import { useAdminOps } from '../../components/admin/admin-health';
import { AdminPage } from '../../components/admin/AdminPage';
import { AdminFlash } from '../../components/admin/AdminFlash';
import { Pager } from '../../components/admin/Pager';
import type { AdminDigestPreview, AdminDigestRun, AdminEmailFailure } from '../../lib/admin-types';

export function Digest(): ReactElement {
  const ops = useAdminOps();
  const digestPaused = ops?.health?.digest.paused ?? null;
  const [runs, setRuns] = useState<CursorState<AdminDigestRun> | null>(null);
  const [runsLoading, setRunsLoading] = useState(true);
  const [runsError, setRunsError] = useState<string | null>(null);

  const [failures, setFailures] = useState<CursorState<AdminEmailFailure> | null>(null);
  const [failuresLoading, setFailuresLoading] = useState(true);
  const [failuresError, setFailuresError] = useState<string | null>(null);

  const [previewOrgId, setPreviewOrgId] = useState('');
  const [previewDate, setPreviewDate] = useState('');
  const [preview, setPreview] = useState<AdminDigestPreview | null>(null);
  const [previewLoading, setPreviewLoading] = useState(false);
  const [previewError, setPreviewError] = useState<string | null>(null);

  const [statusMessage, setStatusMessage] = useState<string | null>(null);
  const [flashTone, setFlashTone] = useState<'ok' | 'risk'>('ok');
  const [busy, setBusy] = useState(false);

  const loadRuns = useCallback(async () => {
    setRunsLoading(true);
    setRunsError(null);
    try {
      const page = await adminApi.listDigestRuns({});
      setRuns(startCursor(page));
    } catch {
      setRunsError('Could not load digest runs.');
    } finally {
      setRunsLoading(false);
    }
  }, []);

  const loadFailures = useCallback(async () => {
    setFailuresLoading(true);
    setFailuresError(null);
    try {
      const page = await adminApi.listEmailFailures({});
      setFailures(startCursor(page));
    } catch {
      setFailuresError('Could not load email failures.');
    } finally {
      setFailuresLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadRuns();
    void loadFailures();
  }, [loadRuns, loadFailures]);

  async function loadMoreRuns(): Promise<void> {
    if (runs === null || runs.nextCursor === null) return;
    try {
      const page = await adminApi.listDigestRuns({ cursor: runs.nextCursor });
      setRuns((prev) => (prev === null ? startCursor(page) : appendCursor(prev, page)));
    } catch {
      setRunsError('Could not load more runs.');
    }
  }

  async function loadMoreFailures(): Promise<void> {
    if (failures === null || failures.nextCursor === null) return;
    try {
      const page = await adminApi.listEmailFailures({ cursor: failures.nextCursor });
      setFailures((prev) => (prev === null ? startCursor(page) : appendCursor(prev, page)));
    } catch {
      setFailuresError('Could not load more failures.');
    }
  }

  async function loadPreview(): Promise<void> {
    if (previewOrgId.trim().length === 0 || previewDate.length === 0) return;
    setPreviewLoading(true);
    setPreviewError(null);
    setPreview(null);
    try {
      const result = await adminApi.digestPreview({
        organizationId: previewOrgId.trim(),
        date: previewDate,
      });
      setPreview(result);
    } catch (cause) {
      setPreviewError(
        cause instanceof ApiError && cause.status === 404
          ? 'No organization or digest preferences found.'
          : 'Could not render preview.',
      );
    } finally {
      setPreviewLoading(false);
    }
  }

  async function pause(): Promise<void> {
    setBusy(true);
    setStatusMessage(null);
    try {
      await adminApi.pauseDigest();
      setFlashTone('ok');
      setStatusMessage('Digest paused.');
      await ops?.refresh();
    } catch {
      setFlashTone('risk');
      setStatusMessage('Could not pause digest.');
    } finally {
      setBusy(false);
    }
  }

  async function resume(): Promise<void> {
    setBusy(true);
    setStatusMessage(null);
    try {
      await adminApi.resumeDigest();
      setFlashTone('ok');
      setStatusMessage('Digest resumed.');
      await ops?.refresh();
    } catch {
      setFlashTone('risk');
      setStatusMessage('Could not resume digest.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <AdminPage
      documentTitle="Digest — Admin"
      heading="Digest"
      note="The daily digest cycle: whether it is running, what it sent, what bounced, and a preview of exactly what one organization would receive."
    >
      <AdminFlash message={statusMessage} tone={flashTone} />

      <section className="admin-panel">
        <h2 className="admin-panel__label">Pause / resume digest</h2>
        {/* Same state-aware shape as the ingestion control. */}
        {digestPaused !== null ? (
          <div className="admin-pause-control">
            <p className="hint">
              {digestPaused
                ? 'The digest is PAUSED — no cycles are being sent. Resuming picks up on the next hourly check; missed local dates are not back-sent.'
                : 'The digest is running. Pausing stops cycles from being sent; nothing is deleted, and resuming picks up on the next hourly check.'}
            </p>
            <ConfirmAction
              label={digestPaused ? 'Resume digest' : 'Pause digest'}
              confirmText={digestPaused ? 'RESUME_DIGEST' : 'PAUSE_DIGEST'}
              busy={busy}
              {...(digestPaused ? {} : { variant: 'danger' as const })}
              onConfirm={() => (digestPaused ? void resume() : void pause())}
            />
          </div>
        ) : (
          <div className="button-row">
            <ConfirmAction
              label="Pause digest"
              confirmText="PAUSE_DIGEST"
              busy={busy}
              variant="danger"
              onConfirm={() => void pause()}
            />
            <ConfirmAction
              label="Resume digest"
              confirmText="RESUME_DIGEST"
              busy={busy}
              onConfirm={() => void resume()}
            />
          </div>
        )}
      </section>

      <section className="admin-section">
        <h2 className="admin-panel__label">Recent digest runs</h2>
        {runsLoading && <p>Loading…</p>}
        {runsError !== null && (
          <p role="alert" className="form-error">
            {runsError}
          </p>
        )}
        {!runsLoading && runs !== null && (
          <>
            <div className="admin-table-scroll">
              <table>
                <caption className="visually-hidden-status">Digest runs</caption>
                <thead>
                  <tr>
                    <th scope="col">Organization</th>
                    <th scope="col">Date</th>
                    <th scope="col">Status</th>
                    <th scope="col">Matches</th>
                    <th scope="col">Sent</th>
                  </tr>
                </thead>
                <tbody>
                  {runs.items.map((run) => (
                    <tr key={run.id}>
                      <td>{run.organizationId}</td>
                      <td>{run.digestDate}</td>
                      <td>{run.status}</td>
                      <td>{run.matchesCount}</td>
                      <td>{formatIsoUtc(run.sentAt)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <Pager
              nextCursor={runs.nextCursor}
              loading={false}
              onLoadMore={() => void loadMoreRuns()}
            />
          </>
        )}
      </section>

      <section className="admin-section">
        <h2 className="admin-panel__label">Email failures</h2>
        {failuresLoading && <p>Loading…</p>}
        {failuresError !== null && (
          <p role="alert" className="form-error">
            {failuresError}
          </p>
        )}
        {!failuresLoading && failures !== null && (
          <>
            <div className="admin-table-scroll">
              <table>
                <caption className="visually-hidden-status">Email delivery failures</caption>
                <thead>
                  <tr>
                    <th scope="col">To</th>
                    <th scope="col">Kind</th>
                    <th scope="col">Provider</th>
                    <th scope="col">Error</th>
                    <th scope="col">Created</th>
                  </tr>
                </thead>
                <tbody>
                  {failures.items.map((failure) => (
                    <tr key={failure.id}>
                      <td>{failure.toEmail}</td>
                      <td>{failure.kind}</td>
                      <td>{failure.provider}</td>
                      <td>{failure.error ?? '—'}</td>
                      <td>{formatIsoUtc(failure.createdAt)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <Pager
              nextCursor={failures.nextCursor}
              loading={false}
              onLoadMore={() => void loadMoreFailures()}
            />
          </>
        )}
      </section>

      <section className="admin-panel">
        <h2 className="admin-panel__label">Preview a digest</h2>
        <form
          className="form-field inline admin-filters"
          onSubmit={(event) => {
            event.preventDefault();
            void loadPreview();
          }}
        >
          <label htmlFor="preview-org">Organization ID</label>
          <input
            id="preview-org"
            value={previewOrgId}
            onChange={(event) => setPreviewOrgId(event.target.value)}
          />
          <label htmlFor="preview-date">Date</label>
          <input
            id="preview-date"
            type="date"
            value={previewDate}
            onChange={(event) => setPreviewDate(event.target.value)}
          />
          <button type="submit">Preview</button>
        </form>
        {previewLoading && <p>Loading…</p>}
        {previewError !== null && (
          <p role="alert" className="form-error">
            {previewError}
          </p>
        )}
        {preview !== null && (
          <>
            {/*
              The preview HTML is our own renderer's already-escaped output,
              but dangerouslySetInnerHTML is banned repo-wide (eslint
              no-restricted-syntax, docs/security.md C2) regardless of
              source. Rendered as plain TEXT in a <pre> — subject, the
              text-alternative, and the raw HTML source — never injected as
              markup.
            */}
            <h3 className="admin-panel__label">Subject</h3>
            <p>{preview.rendered.subject}</p>
            <h3 className="admin-panel__label">Text alternative</h3>
            <pre className="admin-code-block">{preview.rendered.text}</pre>
            <h3 className="admin-panel__label">Raw HTML source (not rendered as markup)</h3>
            <pre className="admin-code-block">{preview.rendered.html}</pre>
          </>
        )}
      </section>
    </AdminPage>
  );
}
