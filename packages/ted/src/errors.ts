/**
 * Error types for the TED client and eForms parser.
 *
 * Every failure mode is explicit and typed: budget exhaustion, HTTP failure
 * after retries, and parse failures carrying field-level issues. Callers
 * (the procurement orchestrator, stage B) route TedParseError into
 * `ingestion_errors` — malformed records are surfaced, never skipped.
 */

/** Severity of a single parse finding. */
export type ParseIssueSeverity = 'error' | 'warning';

/**
 * One field-level finding produced while normalizing an eForms notice.
 * `error` severity means the notice cannot be safely normalized (the parse
 * throws `TedParseError`); `warning` records a tolerated anomaly on the
 * successfully parsed result (e.g. unknown SDK minor version, fallback
 * source id). We never fabricate values to avoid an issue.
 */
export interface ParseIssue {
  readonly severity: ParseIssueSeverity;
  /** Stable machine-readable code, e.g. `missing-customization-id`. */
  readonly code: string;
  readonly message: string;
  /** Human-oriented locator (element path / lot id), when known. */
  readonly path?: string;
}

/** Thrown when the per-run request budget is spent; the run must stop. */
export class TedBudgetExceededError extends Error {
  readonly requestsUsed: number;
  readonly maxRequestsPerRun: number;

  constructor(requestsUsed: number, maxRequestsPerRun: number) {
    super(
      `TED request budget exceeded: ${String(requestsUsed)}/${String(maxRequestsPerRun)} requests used this run`,
    );
    this.name = 'TedBudgetExceededError';
    this.requestsUsed = requestsUsed;
    this.maxRequestsPerRun = maxRequestsPerRun;
  }
}

/** Thrown when an HTTP request fails after all retries (or is non-retryable). */
export class TedRequestError extends Error {
  /** Last HTTP status observed, or null for network-level failures. */
  readonly status: number | null;
  /** Total attempts made (1 initial + retries). */
  readonly attempts: number;
  readonly url: string;

  constructor(message: string, opts: { status: number | null; attempts: number; url: string }) {
    super(message);
    this.name = 'TedRequestError';
    this.status = opts.status;
    this.attempts = opts.attempts;
    this.url = opts.url;
  }
}

/**
 * Thrown when the notice-XML endpoint signals "document not rendered yet":
 * HTTP 202, or a 2xx with an empty body. Since ~2026-08-17 the anonymous
 * `ted.europa.eu/<lang>/notice/<id>/xml` front-end renders XML
 * ASYNCHRONOUSLY — the first request queues the render and answers
 * `202 Accepted` with an empty body; a later request is served the cached
 * document (diagnosed live: ted-diagnose CI runs 32131289081/32131832286/
 * 32132169652, 2026-08-18). The caller (procurement's run-window) requeues
 * the notice and retries after a delay instead of failing the window
 * outright — the render was already triggered by this very request.
 */
export class TedRenderPendingError extends Error {
  readonly url: string;
  readonly status: number;

  constructor(url: string, status: number) {
    super(`TED notice XML not rendered yet (HTTP ${String(status)}, empty body): ${url}`);
    this.name = 'TedRenderPendingError';
    this.url = url;
    this.status = status;
  }
}

/**
 * Thrown when a notice XML fetch exceeds `MAX_XML_BYTES` (client.ts) —
 * either the `Content-Length` header declared an oversized body, or the
 * actual decoded body did (headers can lie or be absent, so both are
 * checked). The caller (procurement's run-window) routes this to
 * `ingestion_errors` and skips just that notice — the window proceeds.
 */
export class TedXmlTooLargeError extends Error {
  readonly url: string;
  /** The byte count that tripped the cap (from whichever check caught it). */
  readonly bytes: number;
  readonly maxBytes: number;

  constructor(url: string, bytes: number, maxBytes: number) {
    super(`notice XML exceeds the ${String(maxBytes)}-byte cap (${String(bytes)} bytes): ${url}`);
    this.name = 'TedXmlTooLargeError';
    this.url = url;
    this.bytes = bytes;
    this.maxBytes = maxBytes;
  }
}

/**
 * Thrown when an eForms notice cannot be normalized. Carries every issue
 * collected (errors and warnings) so `ingestion_errors` records the full
 * diagnosis, plus the source notice id when it could be determined.
 */
export class TedParseError extends Error {
  readonly issues: readonly ParseIssue[];
  readonly sourceNoticeId: string | null;

  constructor(issues: readonly ParseIssue[], sourceNoticeId: string | null) {
    const firstError = issues.find((issue) => issue.severity === 'error');
    super(
      `eForms notice parse failed${sourceNoticeId ? ` (${sourceNoticeId})` : ''}: ` +
        (firstError ? `${firstError.code}: ${firstError.message}` : 'unknown error'),
    );
    this.name = 'TedParseError';
    this.issues = issues;
    this.sourceNoticeId = sourceNoticeId;
  }
}
