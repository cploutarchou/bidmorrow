import { useEffect, useState, type ReactElement } from 'react';
import { adminApi } from '../../lib/admin-api';
import { formatIsoUtc } from '../../lib/format';
import type { AdminHealthDetails, AdminUsageCounts } from '../../lib/admin-types';

export function Dashboard(): ReactElement {
  const [health, setHealth] = useState<AdminHealthDetails | null>(null);
  const [usage, setUsage] = useState<AdminUsageCounts | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    async function load(): Promise<void> {
      setLoading(true);
      setError(null);
      try {
        const [h, u] = await Promise.all([adminApi.healthDetails(), adminApi.usage()]);
        setHealth(h);
        setUsage(u);
      } catch {
        setError('Could not load dashboard data. Please refresh.');
      } finally {
        setLoading(false);
      }
    }
    void load();
  }, []);

  return (
    <>
      <title>Admin dashboard — BidMorrow</title>
      <h1>Dashboard</h1>
      {loading && <p>Loading…</p>}
      {error !== null && (
        <p role="alert" className="form-error">
          {error}
        </p>
      )}
      {health !== null && (
        <>
          <section>
            <h2>Ingestion</h2>
            <p className={health.ingestion.stale ? 'form-warning' : undefined}>
              <strong>Status: {health.ingestion.stale ? 'STALE' : 'OK'}</strong> — last successful
              run: {formatIsoUtc(health.ingestion.lastSuccessfulRunAt)}
            </p>
            <p>
              Paused: <strong>{health.ingestion.paused ? 'Yes' : 'No'}</strong> · Errors (24h):{' '}
              {health.ingestion.errors24h}
            </p>
          </section>

          <section>
            <h2>Digest</h2>
            <p>
              Paused: <strong>{health.digest.paused ? 'Yes' : 'No'}</strong>
            </p>
            <h3>Recent digest cycle runs</h3>
            {health.digest.recentRuns.length === 0 ? (
              <p>No recent digest runs.</p>
            ) : (
              <div className="admin-table-scroll">
                <table>
                  <caption className="visually-hidden-status">Recent digest runs</caption>
                  <thead>
                    <tr>
                      <th scope="col">Organization</th>
                      <th scope="col">Date</th>
                      <th scope="col">Status</th>
                    </tr>
                  </thead>
                  <tbody>
                    {health.digest.recentRuns.map((run, i) => (
                      <tr key={`${run.organizationId}-${run.digestDate}-${String(i)}`}>
                        <td>{run.organizationId}</td>
                        <td>{run.digestDate}</td>
                        <td>{run.status}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </section>

          <section>
            <h2>Email</h2>
            <p>Failures (24h): {health.email.failures24h}</p>
          </section>

          <section>
            <h2>Database size</h2>
            {health.db.measured ? (
              <p>Approx. size: {(health.db.approxBytes ?? 0).toLocaleString()} bytes (measured)</p>
            ) : (
              <p>
                Size not measured — the PRAGMA-based estimate was unavailable, this is honestly
                reported as unmeasured rather than shown as zero.
              </p>
            )}
          </section>

          <section>
            <h2>Dead-letter queue</h2>
            <p>{health.dlq.note}</p>
          </section>

          <section>
            <h2>Flag states</h2>
            <div className="admin-table-scroll">
              <table>
                <caption className="visually-hidden-status">Feature flag states</caption>
                <thead>
                  <tr>
                    <th scope="col">Key</th>
                    <th scope="col">Value</th>
                  </tr>
                </thead>
                <tbody>
                  {health.flags.map((flag) => (
                    <tr key={flag.key}>
                      <td>{flag.key}</td>
                      <td>{flag.value ?? '(unset)'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>
        </>
      )}

      {usage !== null && (
        <section>
          <h2>Usage counts</h2>
          <dl className="detail-facts">
            <div>
              <dt>Organizations</dt>
              <dd>{usage.organizations}</dd>
            </div>
            <div>
              <dt>Users</dt>
              <dd>{usage.users}</dd>
            </div>
            <div>
              <dt>Notices</dt>
              <dd>{usage.notices}</dd>
            </div>
            <div>
              <dt>Lots</dt>
              <dd>{usage.lots}</dd>
            </div>
            <div>
              <dt>Matches</dt>
              <dd>{usage.matches}</dd>
            </div>
          </dl>
        </section>
      )}
    </>
  );
}
