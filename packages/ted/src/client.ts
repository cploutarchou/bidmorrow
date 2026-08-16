/**
 * TED Search API client (docs/ted-data-source.md, verified 2026-08-14).
 *
 * - Anonymous: the Search API takes no API key.
 * - Polite by construction: strictly sequential (concurrency 1), enforced
 *   minimum spacing between request starts, exponential backoff with jitter
 *   on 429/5xx honoring `Retry-After`, and a hard per-run request budget
 *   (TedBudgetExceededError once spent). No official TED rate limit is
 *   documented — these are our self-imposed defaults (flag #1 in
 *   docs/ted-data-source.md).
 * - Every request outcome is logged via @bidmorrow/observability with counts
 *   and metadata only — never request/response bodies.
 */

import type { Logger } from '@bidmorrow/observability';

import { TedBudgetExceededError, TedRequestError, TedXmlTooLargeError } from './errors';
import { TED_API_BASE } from './index';
import type { TedSearchRequest } from './index';

/** Response of POST /v3/notices/search. Notices are records of the requested fields. */
export interface TedSearchResponse {
  readonly notices: readonly Readonly<Record<string, unknown>>[];
  readonly totalNoticeCount: number;
  /** Present in ITERATION mode while more pages remain. */
  readonly iterationNextToken?: string;
}

/** Fetch-shaped function (the ambient minimal types live in globals.d.ts). */
export type TedFetch = (url: string, init?: TedFetchRequestInit) => Promise<TedFetchResponse>;

export interface TedClientOptions {
  /** Injected fetch (test seam; `globalThis.fetch` in production). */
  readonly fetch: TedFetch;
  /** API origin; defaults to TED_API_BASE. */
  readonly baseUrl?: string;
  /** Hard cap on HTTP requests (including retries) per run — admin config. */
  readonly budget: { readonly maxRequestsPerRun: number };
  /** Minimum ms between request starts (default 500 — self-imposed politeness). */
  readonly minRequestSpacingMs?: number;
  readonly logger: Logger;
  /** Injected randomness for backoff jitter (test seam). */
  readonly random?: () => number;
}

const MAX_RETRIES = 4;
const BACKOFF_BASE_MS = 1_000;
const BACKOFF_JITTER_MS = 250;
const DEFAULT_SPACING_MS = 500;

/**
 * Identifying User-Agent, sent on every TED request. Empirically REQUIRED
 * for notice-XML downloads (2026-08-16, fixture-fetch CI runs 31976779119
 * vs 31977377822): the ted.europa.eu website front-end answers a bare
 * fetch of `links.xml.MUL` with HTTP 200 and an EMPTY body, and serves the
 * real XML once the client states an Accept and identifies itself. The
 * search API never showed this, but gets the same identification —
 * transparency toward the data provider costs nothing.
 */
export const TED_USER_AGENT = 'BidMorrow/1.0 (+https://bidmorrow.com; support@bidmorrow.com)';
const XML_ACCEPT = 'application/xml, text/xml;q=0.9, */*;q=0.5';

/** Hosts we allow notice-XML fetches from (links come from TED responses, but never trust data-driven URLs blindly). */
const ALLOWED_XML_HOST_SUFFIX = '.ted.europa.eu';
const ALLOWED_XML_HOST = 'ted.europa.eu';

/**
 * Hard cap on a single notice XML's decoded size. Notices are normally
 * kilobytes to low-single-digit megabytes; this bounds worst-case memory/CPU
 * for one bad or malicious response without touching legitimate notices.
 */
export const MAX_XML_BYTES = 15_000_000;

function isRetryableStatus(status: number): boolean {
  return status === 429 || status >= 500;
}

/** Parse a Retry-After header (delta-seconds form only) into millis, or null. */
function retryAfterMillis(header: string | null): number | null {
  if (header === null) {
    return null;
  }
  // Linear check: all digits (HTTP-date form is ignored — backoff still applies).
  if (!/^\d{1,6}$/.test(header.trim())) {
    return null;
  }
  return Number(header.trim()) * 1_000;
}

export class TedClient {
  private readonly fetchImpl: TedFetch;
  private readonly baseUrl: string;
  private readonly maxRequestsPerRun: number;
  private readonly minRequestSpacingMs: number;
  private readonly logger: Logger;
  private readonly random: () => number;

  private requestsUsed = 0;
  private lastRequestStartedAt: number | null = null;
  /** Serializes all requests — concurrency is 1 by construction. */
  private queue: Promise<unknown> = Promise.resolve();

  constructor(options: TedClientOptions) {
    this.fetchImpl = options.fetch;
    this.baseUrl = options.baseUrl ?? TED_API_BASE;
    this.maxRequestsPerRun = options.budget.maxRequestsPerRun;
    this.minRequestSpacingMs = options.minRequestSpacingMs ?? DEFAULT_SPACING_MS;
    this.logger = options.logger;
    this.random = options.random ?? Math.random;
  }

  /** HTTP requests spent so far this run (each retry attempt counts). */
  get requestsUsedThisRun(): number {
    return this.requestsUsed;
  }

  /** POST /v3/notices/search. */
  async searchNotices(request: TedSearchRequest): Promise<TedSearchResponse> {
    const url = `${this.baseUrl}/v3/notices/search`;
    const response = await this.requestWithRetry(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Accept: 'application/json',
        'User-Agent': TED_USER_AGENT,
      },
      body: JSON.stringify(request),
    });
    let body: unknown;
    try {
      body = await response.json();
    } catch {
      throw new TedRequestError('TED search response was not valid JSON', {
        status: response.status,
        attempts: 1,
        url,
      });
    }
    const parsed = asSearchResponse(body);
    if (parsed === null) {
      throw new TedRequestError('TED search response did not match the documented shape', {
        status: response.status,
        attempts: 1,
        url,
      });
    }
    this.logger.info('ted.search.ok', {
      notice_count: parsed.notices.length,
      total_notice_count: parsed.totalNoticeCount,
      has_next_token: parsed.iterationNextToken !== undefined,
    });
    return parsed;
  }

  /**
   * Fetch a notice's source XML (`links.xml.MUL` URL from a search row).
   * Only https URLs on ted.europa.eu hosts are accepted — links are data
   * from an external API and must not turn the worker into an open proxy.
   */
  async fetchNoticeXml(url: string): Promise<string> {
    let parsed: URL;
    try {
      parsed = new URL(url);
    } catch {
      throw new TedRequestError(`invalid notice XML URL`, { status: null, attempts: 0, url });
    }
    if (
      parsed.protocol !== 'https:' ||
      (parsed.hostname !== ALLOWED_XML_HOST && !parsed.hostname.endsWith(ALLOWED_XML_HOST_SUFFIX))
    ) {
      throw new TedRequestError('notice XML URL must be https on a ted.europa.eu host', {
        status: null,
        attempts: 0,
        url,
      });
    }
    const response = await this.requestWithRetry(url, {
      method: 'GET',
      headers: { Accept: XML_ACCEPT, 'User-Agent': TED_USER_AGENT },
    });
    // Content-Length is checked first to reject an oversized body before
    // buffering it, but it is untrusted (can lie or be absent) — the actual
    // decoded size is checked below regardless.
    const contentLengthHeader = response.headers.get('Content-Length');
    if (contentLengthHeader !== null) {
      const declaredBytes = Number(contentLengthHeader);
      if (Number.isFinite(declaredBytes) && declaredBytes > MAX_XML_BYTES) {
        throw new TedXmlTooLargeError(url, declaredBytes, MAX_XML_BYTES);
      }
    }
    const xml = await response.text();
    if (xml.trim().length === 0) {
      // HTTP 200 with an empty body is how ted.europa.eu refuses requests it
      // does not like (observed for unidentified clients) — surface it as a
      // failed fetch, never as valid "empty XML" for parsing/snapshotting.
      throw new TedRequestError('TED notice XML response body was empty', {
        status: response.status,
        attempts: 1,
        url,
      });
    }
    const actualBytes = new TextEncoder().encode(xml).length;
    if (actualBytes > MAX_XML_BYTES) {
      throw new TedXmlTooLargeError(url, actualBytes, MAX_XML_BYTES);
    }
    this.logger.info('ted.notice_xml.ok', { bytes: actualBytes });
    return xml;
  }

  /**
   * Iterate all ITERATION-mode pages for one bounded window query. Stops
   * when the API returns no continuation token or an empty page; the
   * request budget bounds the loop unconditionally.
   */
  async *iterateSearch(request: TedSearchRequest): AsyncGenerator<TedSearchResponse, void> {
    let token: string | undefined = request.iterationNextToken;
    for (;;) {
      const page: TedSearchResponse = await this.searchNotices({
        ...request,
        paginationMode: 'ITERATION',
        ...(token === undefined ? {} : { iterationNextToken: token }),
      });
      yield page;
      if (page.iterationNextToken === undefined || page.notices.length === 0) {
        return;
      }
      if (page.iterationNextToken === token) {
        // Defensive: a token that never advances must not loop forever.
        this.logger.warn('ted.iteration.stalled_token', {});
        return;
      }
      token = page.iterationNextToken;
    }
  }

  /** One logical request: serialized, spaced, retried with backoff. */
  private requestWithRetry(url: string, init: TedFetchRequestInit): Promise<TedFetchResponse> {
    const run = this.queue.then(() => this.performWithRetry(url, init));
    // Keep the chain alive even when a request fails.
    this.queue = run.catch(() => undefined);
    return run;
  }

  private async performWithRetry(
    url: string,
    init: TedFetchRequestInit,
  ): Promise<TedFetchResponse> {
    let lastStatus: number | null = null;
    for (let attempt = 1; attempt <= 1 + MAX_RETRIES; attempt += 1) {
      const outcome = await this.performOnce(url, init, attempt);
      if ('response' in outcome) {
        const response = outcome.response;
        if (response.ok) {
          return response;
        }
        lastStatus = response.status;
        if (!isRetryableStatus(response.status)) {
          throw new TedRequestError(`TED request failed with status ${String(response.status)}`, {
            status: response.status,
            attempts: attempt,
            url,
          });
        }
        if (attempt <= MAX_RETRIES) {
          const retryAfter = retryAfterMillis(response.headers.get('Retry-After'));
          await this.sleep(this.backoffDelay(attempt, retryAfter));
          continue;
        }
      } else {
        // Network-level failure — retryable.
        lastStatus = null;
        if (attempt <= MAX_RETRIES) {
          await this.sleep(this.backoffDelay(attempt, null));
          continue;
        }
      }
    }
    throw new TedRequestError(`TED request failed after ${String(1 + MAX_RETRIES)} attempts`, {
      status: lastStatus,
      attempts: 1 + MAX_RETRIES,
      url,
    });
  }

  /** Single HTTP attempt: budget check, spacing, fetch, outcome log. */
  private async performOnce(
    url: string,
    init: TedFetchRequestInit,
    attempt: number,
  ): Promise<{ response: TedFetchResponse } | { networkError: string }> {
    if (this.requestsUsed >= this.maxRequestsPerRun) {
      throw new TedBudgetExceededError(this.requestsUsed, this.maxRequestsPerRun);
    }
    await this.enforceSpacing();
    this.requestsUsed += 1;
    this.lastRequestStartedAt = Date.now();
    const startedAt = Date.now();
    try {
      const response = await this.fetchImpl(url, init);
      this.logger.info('ted.request', {
        method: init.method ?? 'GET',
        status: response.status,
        attempt,
        duration_ms: Date.now() - startedAt,
        requests_used: this.requestsUsed,
      });
      return { response };
    } catch (cause) {
      this.logger.warn('ted.request.network_error', {
        method: init.method ?? 'GET',
        attempt,
        requests_used: this.requestsUsed,
        error: cause instanceof Error ? cause.message : String(cause),
      });
      return { networkError: cause instanceof Error ? cause.message : String(cause) };
    }
  }

  private async enforceSpacing(): Promise<void> {
    if (this.lastRequestStartedAt === null) {
      return;
    }
    const elapsed = Date.now() - this.lastRequestStartedAt;
    const remaining = this.minRequestSpacingMs - elapsed;
    if (remaining > 0) {
      await this.sleep(remaining);
    }
  }

  /** Exponential backoff with jitter; Retry-After wins when larger. */
  private backoffDelay(attempt: number, retryAfterMs: number | null): number {
    const exponential = BACKOFF_BASE_MS * 2 ** (attempt - 1) + this.random() * BACKOFF_JITTER_MS;
    return retryAfterMs !== null ? Math.max(retryAfterMs, exponential) : exponential;
  }

  private sleep(ms: number): Promise<void> {
    return new Promise((resolve) => {
      setTimeout(resolve, ms);
    });
  }
}

/** Minimal structural validation of the documented search response shape. */
function asSearchResponse(body: unknown): TedSearchResponse | null {
  if (typeof body !== 'object' || body === null) {
    return null;
  }
  const record = body as Record<string, unknown>;
  const notices = record['notices'];
  const total = record['totalNoticeCount'];
  const token = record['iterationNextToken'];
  if (!Array.isArray(notices) || typeof total !== 'number') {
    return null;
  }
  if (!notices.every((item) => typeof item === 'object' && item !== null)) {
    return null;
  }
  return {
    notices: notices as Readonly<Record<string, unknown>>[],
    totalNoticeCount: total,
    ...(typeof token === 'string' && token.length > 0 ? { iterationNextToken: token } : {}),
  };
}
