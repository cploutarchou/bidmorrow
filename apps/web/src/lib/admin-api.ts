/**
 * Typed `/api/admin/*` wrappers over the shared `api` fetch helper
 * (lib/api.ts). No client-side authorization logic lives here — every
 * function just calls the endpoint and lets the caller branch on
 * `ApiError.status` (404 = not an admin / route hidden, per
 * apps/worker/src/middleware/admin.ts).
 */
import { api } from './api';
import type {
  AdminAuditEvent,
  AdminDigestPreview,
  AdminDigestRun,
  AdminEmailFailure,
  AdminFlag,
  AdminHealthDetails,
  AdminIngestionError,
  AdminIngestionRun,
  AdminMatchTraceResult,
  AdminNoticeDebugBundle,
  AdminOrgDetail,
  AdminOrgSummary,
  AdminPage,
  AdminSubscription,
  AdminSupportNote,
  AdminUsageCounts,
  AdminUserSummary,
} from './admin-types';

function qs(params: Record<string, string | undefined>): string {
  const search = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (value !== undefined && value.length > 0) search.set(key, value);
  }
  const s = search.toString();
  return s.length > 0 ? `?${s}` : '';
}

export const adminApi = {
  healthDetails: (): Promise<AdminHealthDetails> => api.get('/api/admin/health-details'),
  usage: (): Promise<AdminUsageCounts> => api.get('/api/admin/usage'),

  searchOrgs: (args: { query?: string; cursor?: string }): Promise<AdminPage<AdminOrgSummary>> =>
    api.get(`/api/admin/orgs${qs(args)}`),
  orgDetail: (id: string): Promise<AdminOrgDetail> => api.get(`/api/admin/orgs/${id}`),
  suspendOrg: (id: string): Promise<{ suspended: true; suspendedAt: number }> =>
    api.post(`/api/admin/orgs/${id}/suspend`, { confirm: 'SUSPEND_ORGANIZATION' }),
  unsuspendOrg: (id: string): Promise<{ suspended: false }> =>
    api.post(`/api/admin/orgs/${id}/unsuspend`, { confirm: 'UNSUSPEND_ORGANIZATION' }),

  searchUsers: (args: { query?: string; cursor?: string }): Promise<AdminPage<AdminUserSummary>> =>
    api.get(`/api/admin/users${qs(args)}`),

  listSubscriptions: (args: {
    status?: string;
    cursor?: string;
  }): Promise<AdminPage<AdminSubscription>> => api.get(`/api/admin/subscriptions${qs(args)}`),

  listIngestionRuns: (args: { cursor?: string }): Promise<AdminPage<AdminIngestionRun>> =>
    api.get(`/api/admin/ingestion/runs${qs(args)}`),
  listIngestionErrors: (args: {
    runId: string;
    cursor?: string;
  }): Promise<AdminPage<AdminIngestionError>> => api.get(`/api/admin/ingestion/errors${qs(args)}`),
  noticeDebugBundle: (sourceNoticeId: string): Promise<AdminNoticeDebugBundle> =>
    api.get(`/api/admin/notices/${encodeURIComponent(sourceNoticeId)}`),
  pauseIngestion: (): Promise<{ paused: true }> =>
    api.post('/api/admin/ingestion/pause', { confirm: 'PAUSE_INGESTION' }),
  resumeIngestion: (): Promise<{ paused: false }> =>
    api.post('/api/admin/ingestion/resume', { confirm: 'RESUME_INGESTION' }),
  updateIngestionScope: (body: {
    cpvFamilies: string[];
    countries: string[];
  }): Promise<{ scope: unknown }> =>
    api.post('/api/admin/ingestion/scope', { ...body, confirm: 'UPDATE_INGESTION_SCOPE' }),
  runBackfill: (body: { fromDate: string; toDate: string }): Promise<{ enqueuedWindows: number }> =>
    api.post('/api/admin/ingestion/backfill', { ...body, confirm: 'RUN_BACKFILL' }),

  matchTrace: (args: { organizationId: string; lotId: string }): Promise<AdminMatchTraceResult> =>
    api.get(`/api/admin/match-trace${qs(args)}`),
  recomputeMatches: (body: {
    noticeIds?: string[];
    lotIds?: string[];
  }): Promise<{ enqueuedMessages: number }> =>
    api.post('/api/admin/matching/recompute', { ...body, confirm: 'RECOMPUTE_MATCHES' }),

  listDigestRuns: (args: { cursor?: string }): Promise<AdminPage<AdminDigestRun>> =>
    api.get(`/api/admin/digest/runs${qs(args)}`),
  digestPreview: (args: { organizationId: string; date: string }): Promise<AdminDigestPreview> =>
    api.get(`/api/admin/digest/preview${qs(args)}`),
  listEmailFailures: (args: { cursor?: string }): Promise<AdminPage<AdminEmailFailure>> =>
    api.get(`/api/admin/email/failures${qs(args)}`),
  pauseDigest: (): Promise<{ paused: true }> =>
    api.post('/api/admin/digest/pause', { confirm: 'PAUSE_DIGEST' }),
  resumeDigest: (): Promise<{ paused: false }> =>
    api.post('/api/admin/digest/resume', { confirm: 'RESUME_DIGEST' }),

  listSupportNotes: (args: {
    organizationId: string;
    cursor?: string;
  }): Promise<AdminPage<AdminSupportNote>> => api.get(`/api/admin/support-notes${qs(args)}`),
  addSupportNote: (body: {
    organizationId: string;
    body: string;
  }): Promise<{
    note: AdminSupportNote;
  }> => api.post('/api/admin/support-notes', body),

  listAuditEvents: (args: {
    actorId?: string;
    action?: string;
    sinceMs?: string;
    cursor?: string;
  }): Promise<AdminPage<AdminAuditEvent>> => api.get(`/api/admin/audit-events${qs(args)}`),

  listFlags: (): Promise<{ items: AdminFlag[] }> => api.get('/api/admin/flags'),
  updateFlag: (
    key: string,
    body: { value: unknown; description?: string },
  ): Promise<{ flag: AdminFlag }> =>
    api.put(`/api/admin/flags/${key}`, { ...body, confirm: 'UPDATE_FLAG' }),
};
