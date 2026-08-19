import { useCallback, useEffect, useState, type ReactElement } from 'react';
import { adminApi } from '../../lib/admin-api';
import { ApiError } from '../../lib/api';
import { appendCursor, startCursor, type CursorState } from '../../lib/cursor';
import { formatIsoUtc } from '../../lib/format';
import { validateBackfillRange } from '../../lib/admin-date-range';
import { validateCpvScope } from '../../lib/admin-scope';
import { ConfirmAction } from '../../components/admin/ConfirmAction';
import { Pager } from '../../components/admin/Pager';
import type {
  AdminIngestionError,
  AdminIngestionFetchRetry,
  AdminIngestionRun,
  AdminNoticeDebugBundle,
} from '../../lib/admin-types';

const MAX_BACKFILL_DAYS = 90;
const MAX_SCOPE_FAMILIES = 20;

export function Ingestion(): ReactElement {
  const [runs, setRuns] = useState<CursorState<AdminIngestionRun> | null>(null);
  const [runsLoading, setRunsLoading] = useState(true);
  const [runsError, setRunsError] = useState<string | null>(null);

  const [fetchRetries, setFetchRetries] = useState<CursorState<AdminIngestionFetchRetry> | null>(
    null,
  );
  const [fetchRetriesCounts, setFetchRetriesCounts] = useState<{
    pending: number;
    recovered: number;
    abandoned: number;
  } | null>(null);
  const [fetchRetriesLoading, setFetchRetriesLoading] = useState(true);
  const [fetchRetriesError, setFetchRetriesError] = useState<string | null>(null);

  const [errorsRunId, setErrorsRunId] = useState('');
  const [errors, setErrors] = useState<CursorState<AdminIngestionError> | null>(null);
  const [errorsLoading, setErrorsLoading] = useState(false);
  const [errorsError, setErrorsError] = useState<string | null>(null);
  const [expandedErrorId, setExpandedErrorId] = useState<string | null>(null);

  const [sourceNoticeId, setSourceNoticeId] = useState('');
  const [notice, setNotice] = useState<AdminNoticeDebugBundle | null>(null);
  const [noticeError, setNoticeError] = useState<string | null>(null);
  const [noticeLoading, setNoticeLoading] = useState(false);

  const [statusMessage, setStatusMessage] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const [cpvFamiliesText, setCpvFamiliesText] = useState('72,48,79417000');
  const [countriesText, setCountriesText] = useState('');

  const [fromDate, setFromDate] = useState('');
  const [toDate, setToDate] = useState('');

  const loadRuns = useCallback(async () => {
    setRunsLoading(true);
    setRunsError(null);
    try {
      const page = await adminApi.listIngestionRuns({});
      setRuns(startCursor(page));
    } catch {
      setRunsError('Could not load ingestion runs.');
    } finally {
      setRunsLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadRuns();
  }, [loadRuns]);

  async function loadMoreRuns(): Promise<void> {
    if (runs === null || runs.nextCursor === null) return;
    try {
      const page = await adminApi.listIngestionRuns({ cursor: runs.nextCursor });
      setRuns((prev) => (prev === null ? startCursor(page) : appendCursor(prev, page)));
    } catch {
      setRunsError('Could not load more runs.');
    }
  }

  const loadFetchRetries = useCallback(async () => {
    setFetchRetriesLoading(true);
    setFetchRetriesError(null);
    try {
      const page = await adminApi.listFetchRetries({});
      setFetchRetriesCounts(page.counts);
      setFetchRetries(startCursor(page));
    } catch {
      setFetchRetriesError('Could not load fetch retries.');
    } finally {
      setFetchRetriesLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadFetchRetries();
  }, [loadFetchRetries]);

  async function loadMoreFetchRetries(): Promise<void> {
    if (fetchRetries === null || fetchRetries.nextCursor === null) return;
    try {
      const page = await adminApi.listFetchRetries({ cursor: fetchRetries.nextCursor });
      setFetchRetriesCounts(page.counts);
      setFetchRetries((prev) => (prev === null ? startCursor(page) : appendCursor(prev, page)));
    } catch {
      setFetchRetriesError('Could not load more fetch retries.');
    }
  }

  async function loadErrors(): Promise<void> {
    if (errorsRunId.trim().length === 0) return;
    setErrorsLoading(true);
    setErrorsError(null);
    try {
      const page = await adminApi.listIngestionErrors({ runId: errorsRunId.trim() });
      setErrors(startCursor(page));
    } catch {
      setErrorsError('Could not load errors for that run.');
    } finally {
      setErrorsLoading(false);
    }
  }

  async function lookupNotice(): Promise<void> {
    if (sourceNoticeId.trim().length === 0) return;
    setNoticeLoading(true);
    setNoticeError(null);
    setNotice(null);
    try {
      const bundle = await adminApi.noticeDebugBundle(sourceNoticeId.trim());
      setNotice(bundle);
    } catch (cause) {
      setNoticeError(
        cause instanceof ApiError && cause.status === 404
          ? 'No notice found with that source notice ID.'
          : 'Could not look up notice.',
      );
    } finally {
      setNoticeLoading(false);
    }
  }

  async function pause(): Promise<void> {
    setBusy(true);
    setStatusMessage(null);
    try {
      await adminApi.pauseIngestion();
      setStatusMessage('Ingestion paused.');
    } catch {
      setStatusMessage('Could not pause ingestion.');
    } finally {
      setBusy(false);
    }
  }

  async function resume(): Promise<void> {
    setBusy(true);
    setStatusMessage(null);
    try {
      await adminApi.resumeIngestion();
      setStatusMessage('Ingestion resumed.');
    } catch {
      setStatusMessage('Could not resume ingestion.');
    } finally {
      setBusy(false);
    }
  }

  const cpvFamilies = cpvFamiliesText
    .split(',')
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
  const countries = countriesText
    .split(',')
    .map((s) => s.trim().toUpperCase())
    .filter((s) => s.length > 0);
  const scopeValidation = validateCpvScope(cpvFamilies, countries);

  async function submitScope(): Promise<void> {
    if (!scopeValidation.valid) return;
    setBusy(true);
    setStatusMessage(null);
    try {
      await adminApi.updateIngestionScope({ cpvFamilies, countries });
      setStatusMessage('Ingestion scope updated.');
    } catch {
      setStatusMessage('Could not update ingestion scope.');
    } finally {
      setBusy(false);
    }
  }

  const rangeValidation = validateBackfillRange(fromDate, toDate, MAX_BACKFILL_DAYS);

  async function submitBackfill(): Promise<void> {
    if (!rangeValidation.valid) return;
    setBusy(true);
    setStatusMessage(null);
    try {
      const result = await adminApi.runBackfill({ fromDate, toDate });
      setStatusMessage(`Backfill enqueued: ${String(result.enqueuedWindows)} windows.`);
    } catch {
      setStatusMessage('Could not enqueue backfill.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <title>Ingestion — Admin</title>
      <h1>Ingestion</h1>
      <p role="status" aria-live="polite" className="visually-hidden-status">
        {statusMessage}
      </p>

      <section>
        <h2>Pause / resume ingestion</h2>
        <div className="button-row">
          <ConfirmAction
            label="Pause ingestion"
            confirmText="PAUSE_INGESTION"
            busy={busy}
            variant="danger"
            onConfirm={() => void pause()}
          />
          <ConfirmAction
            label="Resume ingestion"
            confirmText="RESUME_INGESTION"
            busy={busy}
            onConfirm={() => void resume()}
          />
        </div>
      </section>

      <section>
        <h2>Recent runs</h2>
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
                <caption className="visually-hidden-status">Ingestion runs</caption>
                <thead>
                  <tr>
                    <th scope="col">Run ID</th>
                    <th scope="col">Status</th>
                    <th scope="col">Window</th>
                    <th scope="col">Notices seen/upserted</th>
                    <th scope="col">Errors</th>
                    <th scope="col">Fetch failures</th>
                    <th scope="col">Started</th>
                    <th scope="col">Finished</th>
                  </tr>
                </thead>
                <tbody>
                  {runs.items.map((run) => (
                    <tr key={run.id}>
                      <td>{run.id}</td>
                      <td>{run.status}</td>
                      <td>
                        {run.windowFrom} – {run.windowTo}
                      </td>
                      <td>
                        {run.noticesSeen} / {run.noticesUpserted}
                      </td>
                      <td>{run.errorsCount}</td>
                      <td>{run.noticesFetchFailed}</td>
                      <td>{formatIsoUtc(run.startedAt)}</td>
                      <td>{formatIsoUtc(run.finishedAt)}</td>
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

      <section>
        <h2>Fetch retries</h2>
        {fetchRetriesCounts !== null && (
          <dl className="detail-facts">
            <div>
              <dt>Pending</dt>
              <dd>{fetchRetriesCounts.pending}</dd>
            </div>
            <div>
              <dt>Recovered</dt>
              <dd>{fetchRetriesCounts.recovered}</dd>
            </div>
            <div>
              <dt>Abandoned</dt>
              <dd>{fetchRetriesCounts.abandoned}</dd>
            </div>
          </dl>
        )}
        {fetchRetriesLoading && <p>Loading…</p>}
        {fetchRetriesError !== null && (
          <p role="alert" className="form-error">
            {fetchRetriesError}
          </p>
        )}
        {!fetchRetriesLoading && fetchRetries !== null && fetchRetries.items.length === 0 && (
          <p>No fetch retries recorded.</p>
        )}
        {!fetchRetriesLoading && fetchRetries !== null && fetchRetries.items.length > 0 && (
          <>
            <div className="admin-table-scroll">
              <table>
                <caption className="visually-hidden-status">Ingestion fetch retries</caption>
                <thead>
                  <tr>
                    <th scope="col">Source notice</th>
                    <th scope="col">Publication date</th>
                    <th scope="col">Attempts</th>
                    <th scope="col">Next attempt</th>
                    <th scope="col">Last error code</th>
                    <th scope="col">Status</th>
                    <th scope="col">Updated</th>
                  </tr>
                </thead>
                <tbody>
                  {fetchRetries.items.map((retry) => (
                    <tr key={retry.id}>
                      <td>{retry.sourceNoticeId}</td>
                      <td>{retry.publicationDate}</td>
                      <td>{retry.attempts}</td>
                      <td>{formatIsoUtc(retry.nextAttemptAt)}</td>
                      <td>{retry.lastErrorCode}</td>
                      <td>{retry.status}</td>
                      <td>{formatIsoUtc(retry.updatedAt)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <Pager
              nextCursor={fetchRetries.nextCursor}
              loading={false}
              onLoadMore={() => void loadMoreFetchRetries()}
            />
          </>
        )}
      </section>

      <section>
        <h2>Errors for a run</h2>
        <form
          className="form-field inline"
          onSubmit={(event) => {
            event.preventDefault();
            void loadErrors();
          }}
        >
          <label htmlFor="errors-run-id">Ingestion run ID</label>
          <input
            id="errors-run-id"
            value={errorsRunId}
            onChange={(event) => setErrorsRunId(event.target.value)}
          />
          <button type="submit">Load errors</button>
        </form>
        {errorsLoading && <p>Loading…</p>}
        {errorsError !== null && (
          <p role="alert" className="form-error">
            {errorsError}
          </p>
        )}
        {errors !== null && errors.items.length === 0 && <p>No errors for that run.</p>}
        {errors !== null && errors.items.length > 0 && (
          <div className="admin-table-scroll">
            <table>
              <caption className="visually-hidden-status">Ingestion errors</caption>
              <thead>
                <tr>
                  <th scope="col">Stage</th>
                  <th scope="col">Error code</th>
                  <th scope="col">Source notice</th>
                  <th scope="col">Message</th>
                  <th scope="col">Detail</th>
                </tr>
              </thead>
              <tbody>
                {errors.items.map((err) => (
                  <tr key={err.id}>
                    <td>{err.stage}</td>
                    <td>{err.errorCode}</td>
                    <td>{err.sourceNoticeId ?? '—'}</td>
                    <td>{err.message}</td>
                    <td>
                      {err.detailJson !== null ? (
                        <>
                          <button
                            type="button"
                            className="link-button"
                            onClick={() =>
                              setExpandedErrorId(expandedErrorId === err.id ? null : err.id)
                            }
                            aria-expanded={expandedErrorId === err.id}
                          >
                            {expandedErrorId === err.id ? 'Hide detail' : 'Show detail'}
                          </button>
                          {expandedErrorId === err.id && <pre>{err.detailJson}</pre>}
                        </>
                      ) : (
                        '—'
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      <section>
        <h2>Notice lookup</h2>
        <form
          className="form-field inline"
          onSubmit={(event) => {
            event.preventDefault();
            void lookupNotice();
          }}
        >
          <label htmlFor="notice-lookup">Source notice ID</label>
          <input
            id="notice-lookup"
            value={sourceNoticeId}
            onChange={(event) => setSourceNoticeId(event.target.value)}
          />
          <button type="submit">Look up</button>
        </form>
        {noticeLoading && <p>Loading…</p>}
        {noticeError !== null && (
          <p role="alert" className="form-error">
            {noticeError}
          </p>
        )}
        {notice !== null && (
          <>
            <h3>Versions</h3>
            <div className="admin-table-scroll">
              <table>
                <caption className="visually-hidden-status">Notice versions</caption>
                <thead>
                  <tr>
                    <th scope="col">Version</th>
                    <th scope="col">Lots</th>
                  </tr>
                </thead>
                <tbody>
                  {notice.versions.map((version) => (
                    <tr key={version.id}>
                      <td>{version.versionNumber}</td>
                      <td>
                        {version.lots.length === 0
                          ? '—'
                          : version.lots
                              .map((lot) => `${lot.lotNumber ?? '?'}: ${lot.title}`)
                              .join('; ')}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <h3>Snapshot keys</h3>
            <div className="admin-table-scroll">
              <table>
                <caption className="visually-hidden-status">Snapshot keys</caption>
                <thead>
                  <tr>
                    <th scope="col">Version</th>
                    <th scope="col">R2 key</th>
                    <th scope="col">Size (bytes)</th>
                    <th scope="col">Deleted</th>
                  </tr>
                </thead>
                <tbody>
                  {notice.snapshots.map((snapshot) => (
                    <tr key={snapshot.r2Key}>
                      <td>{snapshot.versionNumber}</td>
                      <td>{snapshot.r2Key}</td>
                      <td>{snapshot.sizeBytes}</td>
                      <td>
                        {snapshot.deletedAt !== null ? formatIsoUtc(snapshot.deletedAt) : 'No'}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </>
        )}
      </section>

      <section>
        <h2>Ingestion scope (CPV families + countries)</h2>
        <div className="form-field">
          <label htmlFor="scope-cpv">
            CPV families (comma-separated, max {MAX_SCOPE_FAMILIES})
          </label>
          <input
            id="scope-cpv"
            value={cpvFamiliesText}
            onChange={(event) => setCpvFamiliesText(event.target.value)}
          />
        </div>
        <div className="form-field">
          <label htmlFor="scope-countries">Countries (comma-separated ISO alpha-2, optional)</label>
          <input
            id="scope-countries"
            value={countriesText}
            onChange={(event) => setCountriesText(event.target.value)}
          />
        </div>
        {scopeValidation.error !== null && (
          <p role="alert" className="form-error">
            {scopeValidation.error}
          </p>
        )}
        {scopeValidation.valid && (
          <ConfirmAction
            label="Update ingestion scope"
            confirmText="UPDATE_INGESTION_SCOPE"
            busy={busy}
            onConfirm={() => void submitScope()}
          />
        )}
      </section>

      <section>
        <h2>Backfill (bounded to {MAX_BACKFILL_DAYS} days)</h2>
        <div className="form-field">
          <label htmlFor="backfill-from">From date</label>
          <input
            id="backfill-from"
            type="date"
            value={fromDate}
            onChange={(event) => setFromDate(event.target.value)}
          />
        </div>
        <div className="form-field">
          <label htmlFor="backfill-to">To date</label>
          <input
            id="backfill-to"
            type="date"
            value={toDate}
            onChange={(event) => setToDate(event.target.value)}
          />
        </div>
        {fromDate.length > 0 && toDate.length > 0 && rangeValidation.error !== null && (
          <p role="alert" className="form-error">
            {rangeValidation.error}
          </p>
        )}
        {rangeValidation.valid && (
          <>
            <p>Window count: {rangeValidation.dayCount}</p>
            <ConfirmAction
              label="Run backfill"
              confirmText="RUN_BACKFILL"
              busy={busy}
              variant="danger"
              onConfirm={() => void submitBackfill()}
            />
          </>
        )}
      </section>
    </>
  );
}
