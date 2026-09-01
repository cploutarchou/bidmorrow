import { useCallback, useEffect, useState, type ReactElement } from 'react';
import { Link, useParams } from 'react-router';
import { adminApi } from '../../lib/admin-api';
import { ApiError } from '../../lib/api';
import { formatIsoUtc } from '../../lib/format';
import { ConfirmAction } from '../../components/admin/ConfirmAction';
import { AdminPage } from '../../components/admin/AdminPage';
import { AdminFlash } from '../../components/admin/AdminFlash';
import type { AdminOrgDetail } from '../../lib/admin-types';

export function OrganizationDetail(): ReactElement {
  const { id } = useParams<{ id: string }>();
  const [detail, setDetail] = useState<AdminOrgDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [statusMessage, setStatusMessage] = useState<string | null>(null);
  const [flashTone, setFlashTone] = useState<'ok' | 'risk'>('ok');

  const load = useCallback(async () => {
    if (id === undefined) return;
    setLoading(true);
    setError(null);
    try {
      const d = await adminApi.orgDetail(id);
      setDetail(d);
    } catch (cause) {
      setError(
        cause instanceof ApiError && cause.status === 404
          ? 'Organization not found.'
          : 'Could not load organization.',
      );
    } finally {
      setLoading(false);
    }
  }, [id]);

  useEffect(() => {
    void load();
  }, [load]);

  async function suspend(): Promise<void> {
    if (id === undefined) return;
    setBusy(true);
    setStatusMessage(null);
    try {
      await adminApi.suspendOrg(id);
      setFlashTone('ok');
      setStatusMessage('Organization suspended.');
      await load();
    } catch {
      setFlashTone('risk');
      setStatusMessage('Could not suspend organization. Please try again.');
    } finally {
      setBusy(false);
    }
  }

  async function unsuspend(): Promise<void> {
    if (id === undefined) return;
    setBusy(true);
    setStatusMessage(null);
    try {
      await adminApi.unsuspendOrg(id);
      setFlashTone('ok');
      setStatusMessage('Organization unsuspended.');
      await load();
    } catch {
      setFlashTone('risk');
      setStatusMessage('Could not unsuspend organization. Please try again.');
    } finally {
      setBusy(false);
    }
  }

  if (loading) return <p>Loading…</p>;
  if (error !== null) {
    return (
      <p role="alert" className="form-error">
        {error}
      </p>
    );
  }
  if (detail === null) return <p>Organization not found.</p>;

  const suspended = detail.organization.suspendedAt !== null;

  return (
    <AdminPage
      documentTitle={`${detail.organization.name} | Admin`}
      heading={detail.organization.name}
      note="Everything the admin surface knows about one organization. Suspension is the only mutation available here, and it is reversible."
    >
      <p>
        <Link to="/admin/orgs">&larr; Back to organizations</Link>
      </p>

      <AdminFlash message={statusMessage} tone={flashTone} />

      <dl className="admin-facts">
        <div className="admin-fact">
          <dt className="admin-fact__label">Organization ID</dt>
          <dd className="admin-fact__value admin-fact__value--sm">{detail.organization.id}</dd>
        </div>
        <div className="admin-fact">
          <dt className="admin-fact__label">Lifecycle status</dt>
          <dd className="admin-fact__value admin-fact__value--sm">{detail.organization.status}</dd>
        </div>
        <div className="admin-fact">
          <dt className="admin-fact__label">Suspension</dt>
          <dd
            className={
              suspended
                ? 'admin-fact__value admin-fact__value--sm admin-tone-risk'
                : 'admin-fact__value admin-fact__value--sm'
            }
          >
            {suspended
              ? `SUSPENDED since ${formatIsoUtc(detail.organization.suspendedAt)}`
              : 'Not suspended'}
          </dd>
        </div>
        <div className="admin-fact">
          <dt className="admin-fact__label">Created</dt>
          <dd className="admin-fact__value admin-fact__value--sm">
            {formatIsoUtc(detail.organization.createdAt)}
          </dd>
        </div>
        <div className="admin-fact">
          <dt className="admin-fact__label">Matches / Saved / Feedback</dt>
          <dd className="admin-fact__value admin-fact__value--sm">
            {detail.counts.matches} / {detail.counts.saved} / {detail.counts.feedback}
          </dd>
        </div>
      </dl>

      <div className="admin-panels">
        <section className="admin-panel">
          <h2 className="admin-panel__label">Members</h2>
          {detail.memberEmails.length === 0 ? (
            <p className="admin-empty">No members.</p>
          ) : (
            <ul className="admin-notes">
              {detail.memberEmails.map((email) => (
                <li key={email} className="admin-note__meta">
                  {email}
                </li>
              ))}
            </ul>
          )}
        </section>

        <section className="admin-panel">
          <h2 className="admin-panel__label">Subscription</h2>
          {detail.subscription === null ? (
            <p className="admin-empty">No subscription on file.</p>
          ) : (
            <pre className="admin-code-block">{JSON.stringify(detail.subscription, null, 2)}</pre>
          )}
        </section>

        <section className="admin-panel">
          <h2 className="admin-panel__label">Digest preferences</h2>
          {detail.digestPreferences === null ? (
            <p className="admin-empty">No digest preferences on file.</p>
          ) : (
            <pre className="admin-code-block">
              {JSON.stringify(detail.digestPreferences, null, 2)}
            </pre>
          )}
        </section>

        <section className="admin-panel">
          <h2 className="admin-panel__label">Company profile</h2>
          {detail.profile === null ? (
            <p className="admin-empty">No profile on file.</p>
          ) : (
            <pre className="admin-code-block">{JSON.stringify(detail.profile, null, 2)}</pre>
          )}
        </section>
      </div>

      <section className="admin-panel">
        <h2 className="admin-panel__label">Suspension control</h2>
        {suspended ? (
          <ConfirmAction
            label="Unsuspend organization"
            confirmText="UNSUSPEND_ORGANIZATION"
            consequence="Access is restored immediately; the digest resumes at the next selection cycle."
            busy={busy}
            onConfirm={() => void unsuspend()}
          />
        ) : (
          <ConfirmAction
            label="Suspend organization"
            confirmText="SUSPEND_ORGANIZATION"
            consequence="Members lose access to the feed at once. Data is kept, and the digest stops selecting this organization."
            busy={busy}
            variant="danger"
            onConfirm={() => void suspend()}
          />
        )}
      </section>

      <p>
        <Link to={`/admin/support?organizationId=${detail.organization.id}`}>
          View support notes for this organization
        </Link>
      </p>
    </AdminPage>
  );
}
