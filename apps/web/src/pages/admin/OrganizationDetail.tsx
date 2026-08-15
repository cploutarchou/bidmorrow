import { useCallback, useEffect, useState, type ReactElement } from 'react';
import { Link, useParams } from 'react-router';
import { adminApi } from '../../lib/admin-api';
import { ApiError } from '../../lib/api';
import { formatIsoUtc } from '../../lib/format';
import { ConfirmAction } from '../../components/admin/ConfirmAction';
import type { AdminOrgDetail } from '../../lib/admin-types';

export function OrganizationDetail(): ReactElement {
  const { id } = useParams<{ id: string }>();
  const [detail, setDetail] = useState<AdminOrgDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [statusMessage, setStatusMessage] = useState<string | null>(null);

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
      setStatusMessage('Organization suspended.');
      await load();
    } catch {
      setStatusMessage('Could not suspend organization — please try again.');
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
      setStatusMessage('Organization unsuspended.');
      await load();
    } catch {
      setStatusMessage('Could not unsuspend organization — please try again.');
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
    <>
      <title>{`${detail.organization.name} — Admin`}</title>
      <p>
        <Link to="/admin/orgs">&larr; Back to organizations</Link>
      </p>
      <h1>{detail.organization.name}</h1>
      <p role="status" aria-live="polite" className="visually-hidden-status">
        {statusMessage}
      </p>

      <dl className="detail-facts">
        <div>
          <dt>Organization ID</dt>
          <dd>{detail.organization.id}</dd>
        </div>
        <div>
          <dt>Lifecycle status</dt>
          <dd>{detail.organization.status}</dd>
        </div>
        <div>
          <dt>Suspension</dt>
          <dd>
            {suspended
              ? `SUSPENDED since ${formatIsoUtc(detail.organization.suspendedAt)}`
              : 'Not suspended'}
          </dd>
        </div>
        <div>
          <dt>Created</dt>
          <dd>{formatIsoUtc(detail.organization.createdAt)}</dd>
        </div>
        <div>
          <dt>Matches / Saved / Feedback</dt>
          <dd>
            {detail.counts.matches} / {detail.counts.saved} / {detail.counts.feedback}
          </dd>
        </div>
      </dl>

      <section>
        <h2>Members</h2>
        {detail.memberEmails.length === 0 ? (
          <p>No members.</p>
        ) : (
          <ul>
            {detail.memberEmails.map((email) => (
              <li key={email}>{email}</li>
            ))}
          </ul>
        )}
      </section>

      <section>
        <h2>Subscription</h2>
        {detail.subscription === null ? (
          <p>No subscription on file.</p>
        ) : (
          <pre>{JSON.stringify(detail.subscription, null, 2)}</pre>
        )}
      </section>

      <section>
        <h2>Digest preferences</h2>
        {detail.digestPreferences === null ? (
          <p>No digest preferences on file.</p>
        ) : (
          <pre>{JSON.stringify(detail.digestPreferences, null, 2)}</pre>
        )}
      </section>

      <section>
        <h2>Company profile</h2>
        {detail.profile === null ? (
          <p>No profile on file.</p>
        ) : (
          <pre>{JSON.stringify(detail.profile, null, 2)}</pre>
        )}
      </section>

      <section>
        <h2>Suspension control</h2>
        {suspended ? (
          <ConfirmAction
            label="Unsuspend organization"
            confirmText="UNSUSPEND_ORGANIZATION"
            busy={busy}
            onConfirm={() => void unsuspend()}
          />
        ) : (
          <ConfirmAction
            label="Suspend organization"
            confirmText="SUSPEND_ORGANIZATION"
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
    </>
  );
}
