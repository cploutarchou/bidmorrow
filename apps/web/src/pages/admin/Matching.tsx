import { useState, type ReactElement } from 'react';
import { adminApi } from '../../lib/admin-api';
import { ApiError } from '../../lib/api';
import { diffComponents, mismatchMarker, type TraceComponent } from '../../lib/admin-trace';
import { ConfirmAction } from '../../components/admin/ConfirmAction';
import type { AdminMatchTraceResult } from '../../lib/admin-types';

const MAX_NOTICE_IDS = 100;
const MAX_LOT_IDS = 500;

function parseIds(text: string): string[] {
  return text
    .split(/[\s,]+/)
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
}

export function Matching(): ReactElement {
  const [organizationId, setOrganizationId] = useState('');
  const [lotId, setLotId] = useState('');
  const [trace, setTrace] = useState<AdminMatchTraceResult | null>(null);
  const [traceLoading, setTraceLoading] = useState(false);
  const [traceError, setTraceError] = useState<string | null>(null);

  const [idKind, setIdKind] = useState<'noticeIds' | 'lotIds'>('noticeIds');
  const [idsText, setIdsText] = useState('');
  const [recomputeStatus, setRecomputeStatus] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function loadTrace(): Promise<void> {
    if (organizationId.trim().length === 0 || lotId.trim().length === 0) return;
    setTraceLoading(true);
    setTraceError(null);
    setTrace(null);
    try {
      const result = await adminApi.matchTrace({
        organizationId: organizationId.trim(),
        lotId: lotId.trim(),
      });
      setTrace(result);
    } catch (cause) {
      setTraceError(
        cause instanceof ApiError && cause.status === 404
          ? 'Organization or lot not found.'
          : 'Could not load match trace.',
      );
    } finally {
      setTraceLoading(false);
    }
  }

  const ids = parseIds(idsText);
  const cap = idKind === 'noticeIds' ? MAX_NOTICE_IDS : MAX_LOT_IDS;
  const idsValid = ids.length > 0 && ids.length <= cap;

  async function submitRecompute(): Promise<void> {
    if (!idsValid) return;
    setBusy(true);
    setRecomputeStatus(null);
    try {
      const result = await adminApi.recomputeMatches(
        idKind === 'noticeIds' ? { noticeIds: ids } : { lotIds: ids },
      );
      setRecomputeStatus(`Enqueued ${String(result.enqueuedMessages)} recompute message(s).`);
    } catch {
      setRecomputeStatus('Could not enqueue recompute.');
    } finally {
      setBusy(false);
    }
  }

  const storedComponents: TraceComponent[] = (trace?.stored?.components ?? []).map((c) => ({
    key: c.componentKey,
    points: c.points,
    maxPoints: c.maxPoints,
    status: c.status,
    explanation: c.explanation,
  }));
  const liveComponents: TraceComponent[] =
    trace?.live?.kind === 'scored'
      ? (trace.live.components ?? []).map((c) => ({
          key: c.key,
          points: c.points,
          maxPoints: c.maxPoints,
          status: c.status,
          explanation: c.explanation,
        }))
      : [];
  const diffRows = trace !== null ? diffComponents(storedComponents, liveComponents) : [];

  return (
    <>
      <title>Matching — Admin</title>
      <h1>Matching</h1>

      <section>
        <h2>Match trace</h2>
        <form
          className="form-field inline"
          onSubmit={(event) => {
            event.preventDefault();
            void loadTrace();
          }}
        >
          <label htmlFor="trace-org">Organization ID</label>
          <input
            id="trace-org"
            value={organizationId}
            onChange={(event) => setOrganizationId(event.target.value)}
          />
          <label htmlFor="trace-lot">Lot ID</label>
          <input id="trace-lot" value={lotId} onChange={(event) => setLotId(event.target.value)} />
          <button type="submit">Trace</button>
        </form>
        {traceLoading && <p>Loading…</p>}
        {traceError !== null && (
          <p role="alert" className="form-error">
            {traceError}
          </p>
        )}
        {trace !== null && (
          <>
            {trace.note !== undefined && <p className="form-warning">{trace.note}</p>}
            <h3>Summary</h3>
            <dl className="detail-facts">
              <div>
                <dt>Stored score / classification</dt>
                <dd>
                  {trace.stored?.match !== undefined
                    ? `${String((trace.stored.match as { score?: unknown }).score ?? '—')} / ${String(
                        (trace.stored.match as { classification?: unknown }).classification ?? '—',
                      )}`
                    : 'No stored match'}
                </dd>
              </div>
              <div>
                <dt>Live recompute</dt>
                <dd>
                  {trace.live === null
                    ? 'Not computed (see note above)'
                    : trace.live.kind === 'excluded'
                      ? `EXCLUDED — ${trace.live.rule ?? ''}`
                      : `${String(trace.live.score ?? '—')} / ${trace.live.classification ?? '—'}`}
                </dd>
              </div>
              <div>
                <dt>Engine version</dt>
                <dd>{trace.engineVersion ?? '—'}</dd>
              </div>
            </dl>

            <h3>Stored vs live components</h3>
            {diffRows.length === 0 ? (
              <p>No components to compare.</p>
            ) : (
              <div className="admin-table-scroll">
                <table>
                  <caption className="visually-hidden-status">
                    Stored vs live match components, mismatches marked in text
                  </caption>
                  <thead>
                    <tr>
                      <th scope="col">Component</th>
                      <th scope="col">Stored points/status</th>
                      <th scope="col">Live points/status</th>
                      <th scope="col">Result</th>
                    </tr>
                  </thead>
                  <tbody>
                    {diffRows.map((row) => (
                      <tr key={row.key}>
                        <td>{row.key}</td>
                        <td>
                          {row.stored !== null
                            ? `${String(row.stored.points)}/${String(row.stored.maxPoints)} (${row.stored.status})`
                            : '—'}
                        </td>
                        <td>
                          {row.live !== null
                            ? `${String(row.live.points)}/${String(row.live.maxPoints)} (${row.live.status})`
                            : '—'}
                        </td>
                        <td>{mismatchMarker(row.mismatch)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}

            <h3>Inputs (raw)</h3>
            <p>Organization scoring profile and mapped lot input, as used by the live recompute:</p>
            <pre>{JSON.stringify(trace.orgProfile ?? null, null, 2)}</pre>
            <pre>{JSON.stringify(trace.lotInput ?? null, null, 2)}</pre>
          </>
        )}
      </section>

      <section>
        <h2>Recompute matches</h2>
        <p role="status" aria-live="polite" className="visually-hidden-status">
          {recomputeStatus}
        </p>
        <fieldset>
          <legend>ID kind</legend>
          <label className="checkbox-row">
            <input
              type="radio"
              name="id-kind"
              checked={idKind === 'noticeIds'}
              onChange={() => setIdKind('noticeIds')}
            />
            Notice IDs (max {MAX_NOTICE_IDS})
          </label>
          <label className="checkbox-row">
            <input
              type="radio"
              name="id-kind"
              checked={idKind === 'lotIds'}
              onChange={() => setIdKind('lotIds')}
            />
            Lot IDs (max {MAX_LOT_IDS})
          </label>
        </fieldset>
        <div className="form-field">
          <label htmlFor="recompute-ids">IDs (comma or whitespace separated)</label>
          <textarea
            id="recompute-ids"
            value={idsText}
            onChange={(event) => setIdsText(event.target.value)}
          />
        </div>
        {idsText.trim().length > 0 && !idsValid && (
          <p role="alert" className="form-error">
            {ids.length === 0
              ? 'Enter at least one ID.'
              : `Bounded to ${String(cap)} IDs (has ${String(ids.length)}).`}
          </p>
        )}
        {idsValid && (
          <ConfirmAction
            label="Enqueue recompute"
            confirmText="RECOMPUTE_MATCHES"
            busy={busy}
            onConfirm={() => void submitRecompute()}
          />
        )}
      </section>
    </>
  );
}
