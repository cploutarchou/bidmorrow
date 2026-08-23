import { useEffect, useState, type ReactElement } from 'react';
import { adminApi } from '../../lib/admin-api';
import { formatIsoUtc } from '../../lib/format';
import { AdminPage } from '../../components/admin/AdminPage';
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
    <AdminPage
      documentTitle="Admin dashboard — BidMorrow"
      heading="Dashboard"
      note="System health at a glance. A paused queue is a deliberate state, not a fault — check the flag before treating it as an incident."
    >
      {loading && <p>Loading…</p>}
      {error !== null && (
        <p role="alert" className="form-error">
          {error}
        </p>
      )}
      {health !== null && (
        <>
          <div className="admin-cards">
            <div
              className={
                health.ingestion.stale ? 'admin-card admin-card--risk' : 'admin-card admin-card--ok'
              }
            >
              <p className="admin-card__label">Ingestion</p>
              <p className="admin-card__value">{health.ingestion.stale ? 'STALE' : 'OK'}</p>
              <p className="admin-card__note">
                Last successful run {formatIsoUtc(health.ingestion.lastSuccessfulRunAt)}
              </p>
            </div>

            <div
              className={health.ingestion.paused ? 'admin-card admin-card--caution' : 'admin-card'}
            >
              <p className="admin-card__label">Ingestion queue</p>
              <p className="admin-card__value">{health.ingestion.paused ? 'Paused' : 'Running'}</p>
              <p className="admin-card__note">
                {health.ingestion.errors24h} error
                {health.ingestion.errors24h === 1 ? '' : 's'} in the last 24 hours
              </p>
            </div>

            <div className={health.digest.paused ? 'admin-card admin-card--caution' : 'admin-card'}>
              <p className="admin-card__label">Digest</p>
              <p className="admin-card__value">{health.digest.paused ? 'Paused' : 'Running'}</p>
              <p className="admin-card__note">
                {health.digest.recentRuns.length} recent cycle run
                {health.digest.recentRuns.length === 1 ? '' : 's'} recorded
              </p>
            </div>

            <div
              className={
                health.email.failures24h > 0 ? 'admin-card admin-card--caution' : 'admin-card'
              }
            >
              <p className="admin-card__label">Email</p>
              <p className="admin-card__value">{health.email.failures24h}</p>
              <p className="admin-card__note">Delivery failures in the last 24 hours</p>
            </div>

            <div className="admin-card">
              <p className="admin-card__label">Database size</p>
              <p className="admin-card__value">
                {health.db.measured
                  ? `${(health.db.approxBytes ?? 0).toLocaleString()} bytes`
                  : 'Unmeasured'}
              </p>
              <p className="admin-card__note">
                {health.db.measured
                  ? 'Approximate, from the PRAGMA-based estimate.'
                  : 'The PRAGMA-based estimate was unavailable. Reported as unmeasured rather than shown as zero, which would read as an empty database.'}
              </p>
            </div>

            <div className="admin-card">
              <p className="admin-card__label">Dead-letter queue</p>
              <p className="admin-card__note">{health.dlq.note}</p>
            </div>
          </div>

          {usage !== null && (
            <section className="admin-section">
              <h2 className="admin-panel__label">Usage counts</h2>
              <div className="admin-facts">
                <div className="admin-fact">
                  <p className="admin-fact__label">Organizations</p>
                  <p className="admin-fact__value">{usage.organizations}</p>
                </div>
                <div className="admin-fact">
                  <p className="admin-fact__label">Users</p>
                  <p className="admin-fact__value">{usage.users}</p>
                </div>
                <div className="admin-fact">
                  <p className="admin-fact__label">Notices</p>
                  <p className="admin-fact__value">{usage.notices}</p>
                </div>
                <div className="admin-fact">
                  <p className="admin-fact__label">Lots</p>
                  <p className="admin-fact__value">{usage.lots}</p>
                </div>
                <div className="admin-fact">
                  <p className="admin-fact__label">Matches</p>
                  <p className="admin-fact__value">{usage.matches}</p>
                </div>
              </div>
            </section>
          )}

          <section className="admin-section">
            <h2 className="admin-panel__label">Recent digest cycle runs</h2>
            {health.digest.recentRuns.length === 0 ? (
              <p className="admin-empty">No recent digest runs.</p>
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

          <section className="admin-section">
            <h2 className="admin-panel__label">Flag states</h2>
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
    </AdminPage>
  );
}
