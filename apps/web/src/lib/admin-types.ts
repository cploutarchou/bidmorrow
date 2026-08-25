/**
 * Response DTO shapes for `/api/admin/*` — kept in sync with
 * apps/worker/src/routes/admin.ts and packages/db/src/repositories/admin.ts.
 * Deep/loosely-specified nested payloads (org scoring profile, engine lot
 * input) are typed as `unknown` and rendered as escaped JSON text rather than
 * re-declared field-for-field here — the admin UI's job is faithful, safe
 * display, not re-deriving the engine's internal types.
 */

export interface AdminPage<T> {
  items: readonly T[];
  nextCursor: string | null;
}

// --- Health / usage ---------------------------------------------------

export interface AdminHealthDetails {
  ingestion: {
    lastSuccessfulRunAt: number | null;
    stale: boolean;
    paused: boolean;
    errors24h: number;
  };
  digest: {
    paused: boolean;
    recentRuns: { organizationId: string; digestDate: string; status: string }[];
  };
  email: { failures24h: number };
  db: { measured: boolean; approxBytes: number | null };
  dlq: { note: string };
  flags: { key: string; value: string | null }[];
}

export interface AdminUsageCounts {
  organizations: number;
  users: number;
  notices: number;
  lots: number;
  matches: number;
}

/** `GET /api/admin/rail-counts` — per-section totals for the shell rail. */
export interface AdminRailCounts {
  organizations: number;
  users: number;
  subscriptions: number;
  ingestionRuns: number;
  digestRuns: number;
  supportNotes: number;
  auditEvents: number;
  flags: number;
}

// --- Organizations / users / subscriptions -----------------------------

export interface AdminOrgSummary {
  id: string;
  name: string;
  status: string;
  suspendedAt: number | null;
  memberCount: number;
  subscription: { status: string; plan: string } | null;
}

export interface AdminOrgDetail {
  organization: {
    id: string;
    name: string;
    status: string;
    suspendedAt: number | null;
    createdAt: number;
  };
  profile: Record<string, unknown> | null;
  subscription: Record<string, unknown> | null;
  digestPreferences: Record<string, unknown> | null;
  memberEmails: readonly string[];
  counts: { matches: number; saved: number; feedback: number };
}

export interface AdminUserSummary {
  id: string;
  email: string;
  emailVerified: boolean;
  organizationIds: readonly string[];
}

export interface AdminSubscription {
  id: string;
  organizationId: string;
  billingCustomerId: string;
  billingSubscriptionId: string | null;
  status: string;
  plan: string;
  currentPeriodEndAt: number | null;
  cancelAtPeriodEnd: number;
  createdAt: number;
  updatedAt: number;
}

// --- Ingestion ops -------------------------------------------------------

export interface AdminIngestionRun {
  id: string;
  source: string;
  status: string;
  windowFrom: string;
  windowTo: string;
  noticesSeen: number;
  noticesUpserted: number;
  versionsCreated: number;
  lotsCreated: number;
  matchesScored: number;
  errorsCount: number;
  /**
   * GENUINE per-notice XML fetch failures recorded as record-and-continue
   * skips (ADR-0008 §1/§5, ADR-0009 §1) — a subset of `errorsCount`,
   * surfaced separately so the runs table distinguishes "healthy partial"
   * from "systemically degraded". No longer includes render-pending
   * exhaustion (see `noticesRenderPending`).
   */
  noticesFetchFailed: number;
  /**
   * Render-pending exhaustion skips (ADR-0009 §1) — the origin cooperated
   * (202/accepted, render just slow), split out of `noticesFetchFailed`
   * because it has no fail ceiling and is not evidence TED is refusing us.
   */
  noticesRenderPending: number;
  startedAt: number;
  finishedAt: number | null;
}

export interface AdminIngestionError {
  id: string;
  ingestionRunId: string;
  source: string;
  sourceNoticeId: string | null;
  stage: string;
  errorCode: string;
  message: string;
  detailJson: string | null;
  createdAt: number;
}

/** `ingestion_fetch_retries` row (ADR-0008 §3 bounded per-notice XML fetch retry queue). */
export interface AdminIngestionFetchRetry {
  id: string;
  source: string;
  sourceNoticeId: string;
  xmlUrl: string;
  /** `YYYY-MM-DD` notice publication date. */
  publicationDate: string;
  attempts: number;
  nextAttemptAt: number;
  lastErrorCode: string;
  status: 'pending' | 'recovered' | 'abandoned';
  createdAt: number;
  updatedAt: number;
}

/** `GET /api/admin/ingestion/fetch-retries` response (ADR-0008 §5 admin surface). */
export interface AdminFetchRetriesPage {
  counts: { pending: number; recovered: number; abandoned: number };
  items: readonly AdminIngestionFetchRetry[];
  nextCursor: string | null;
}

export interface AdminNoticeDebugBundle {
  notice: Record<string, unknown>;
  versions: {
    id: string;
    versionNumber: number;
    lots: { id: string; lotNumber: string | null; title: string }[];
    [key: string]: unknown;
  }[];
  snapshots: {
    versionNumber: number;
    r2Key: string;
    sizeBytes: number;
    deletedAt: number | null;
  }[];
}

// --- Matching --------------------------------------------------------------

export interface AdminMatchTraceComponent {
  componentKey: string;
  points: number;
  maxPoints: number;
  status: string;
  explanation: string;
}

export interface AdminMatchTraceResult {
  stored: {
    match: Record<string, unknown>;
    components: AdminMatchTraceComponent[];
    riskFlags: unknown[];
  } | null;
  orgProfile?: unknown;
  lotInput?: unknown;
  engineVersion?: string;
  live: {
    kind: 'excluded' | 'scored';
    score?: number;
    classification?: string;
    components?: {
      key: string;
      points: number;
      maxPoints: number;
      status: string;
      explanation: string;
    }[];
    riskFlags?: unknown[];
    rule?: string;
    evidence?: string;
  } | null;
  note?: string;
}

// --- Digest / email ----------------------------------------------------

export interface AdminDigestRun {
  id: string;
  organizationId: string;
  digestDate: string;
  status: string;
  matchesCount: number;
  sentAt: number | null;
  createdAt: number;
}

export interface AdminEmailFailure {
  id: string;
  organizationId: string | null;
  userId: string | null;
  kind: string;
  toEmail: string;
  provider: string;
  status: string;
  error: string | null;
  createdAt: number;
}

export interface AdminDigestPreview {
  rendered: { subject: string; html: string; text: string };
}

// --- Support / audit / flags --------------------------------------------

export interface AdminSupportNote {
  id: string;
  organizationId: string;
  authorUserId: string;
  body: string;
  createdAt: number;
}

export interface AdminAuditEvent {
  id: string;
  actorType: string;
  actorId: string | null;
  organizationId: string | null;
  action: string;
  targetType: string;
  targetId: string | null;
  beforeSummary: string | null;
  afterSummary: string | null;
  occurredAt: number;
}

export interface AdminFlag {
  key: string;
  value: string | null;
  description: string | null;
  updatedAt: number | null;
}
