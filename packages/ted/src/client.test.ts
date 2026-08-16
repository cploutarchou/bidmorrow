/**
 * TedClient behavior tests with an injected fake fetch and fake timers:
 * request spacing, exponential backoff honoring Retry-After, hard per-run
 * budget, and ITERATION-token loop termination. No real network ever.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { createLogger } from '@bidmorrow/observability';

import { TED_USER_AGENT, TedClient } from './client';
import type { TedFetch } from './client';
import { TedBudgetExceededError, TedRequestError, TedXmlTooLargeError } from './errors';

interface FakeResponseSpec {
  readonly status: number;
  readonly body?: unknown;
  readonly headers?: Record<string, string>;
}

interface RecordedCall {
  readonly url: string;
  readonly at: number;
  readonly body: unknown;
  readonly headers: Record<string, string>;
}

/** Queue-driven fake fetch recording call times (fake-timer clock). */
function makeFakeFetch(specs: (FakeResponseSpec | Error)[]) {
  const calls: RecordedCall[] = [];
  const fetchImpl: TedFetch = (url, init) => {
    calls.push({
      url,
      at: Date.now(),
      body: init?.body === undefined ? null : JSON.parse(init.body),
      headers: init?.headers ?? {},
    });
    const spec = specs.shift();
    if (spec === undefined) {
      throw new Error('fake fetch exhausted — test enqueued too few responses');
    }
    if (spec instanceof Error) {
      return Promise.reject(spec);
    }
    const headers = spec.headers ?? {};
    return Promise.resolve({
      ok: spec.status >= 200 && spec.status < 300,
      status: spec.status,
      headers: {
        get: (name: string) => {
          const found = Object.entries(headers).find(
            ([key]) => key.toLowerCase() === name.toLowerCase(),
          );
          return found?.[1] ?? null;
        },
      },
      json: () => Promise.resolve(spec.body),
      text: () => Promise.resolve(String(spec.body)),
    });
  };
  return { fetchImpl, calls };
}

function searchBody(overrides?: Partial<{ notices: unknown[]; token: string }>) {
  return {
    notices: overrides?.notices ?? [{ 'publication-number': '00001-2026' }],
    totalNoticeCount: 1,
    ...(overrides?.token === undefined ? {} : { iterationNextToken: overrides.token }),
  };
}

const REQUEST = {
  query: 'publication-date >= 20260801',
  fields: ['publication-number'],
  limit: 250,
} as const;

function makeClient(fetchImpl: TedFetch, overrides?: { maxRequestsPerRun?: number }) {
  return new TedClient({
    fetch: fetchImpl,
    budget: { maxRequestsPerRun: overrides?.maxRequestsPerRun ?? 10 },
    logger: createLogger({ test: 'ted-client' }),
    random: () => 0, // deterministic jitter for timing assertions
  });
}

beforeEach(() => {
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
});

describe('TedClient.searchNotices', () => {
  it('POSTs the documented body to /v3/notices/search and returns the typed response', async () => {
    const { fetchImpl, calls } = makeFakeFetch([{ status: 200, body: searchBody() }]);
    const client = makeClient(fetchImpl);
    const response = await client.searchNotices(REQUEST);
    expect(calls).toHaveLength(1);
    expect(calls[0]?.url).toBe('https://api.ted.europa.eu/v3/notices/search');
    expect(calls[0]?.body).toEqual({
      query: 'publication-date >= 20260801',
      fields: ['publication-number'],
      limit: 250,
    });
    expect(response.notices).toEqual([{ 'publication-number': '00001-2026' }]);
    expect(response.totalNoticeCount).toBe(1);
    expect(response.iterationNextToken).toBeUndefined();
  });

  it('enforces the 500 ms minimum spacing between request starts', async () => {
    const { fetchImpl, calls } = makeFakeFetch([
      { status: 200, body: searchBody() },
      { status: 200, body: searchBody() },
    ]);
    const client = makeClient(fetchImpl);
    await client.searchNotices(REQUEST);

    const second = client.searchNotices(REQUEST);
    // Before the spacing window elapses the second request must NOT start.
    await vi.advanceTimersByTimeAsync(499);
    expect(calls).toHaveLength(1);
    await vi.advanceTimersByTimeAsync(1);
    await second;
    expect(calls).toHaveLength(2);
    const gap = (calls[1]?.at ?? 0) - (calls[0]?.at ?? 0);
    expect(gap).toBeGreaterThanOrEqual(500);
  });

  it('retries 429 with backoff and honors a larger Retry-After', async () => {
    const { fetchImpl, calls } = makeFakeFetch([
      { status: 429, headers: { 'Retry-After': '3' } },
      { status: 200, body: searchBody() },
    ]);
    const client = makeClient(fetchImpl);
    const pending = client.searchNotices(REQUEST);
    pending.catch(() => undefined); // avoid unhandled rejection noise on failure paths

    await vi.advanceTimersByTimeAsync(2_999);
    expect(calls).toHaveLength(1); // Retry-After (3 s) > backoff (1 s) — must wait
    await vi.advanceTimersByTimeAsync(1);
    const response = await pending;
    expect(calls).toHaveLength(2);
    expect((calls[1]?.at ?? 0) - (calls[0]?.at ?? 0)).toBe(3_000);
    expect(response.totalNoticeCount).toBe(1);
  });

  it('backs off exponentially on 5xx and fails with TedRequestError after 5 attempts', async () => {
    const { fetchImpl, calls } = makeFakeFetch([
      { status: 500 },
      { status: 502 },
      { status: 503 },
      { status: 500 },
      { status: 500 },
    ]);
    const client = makeClient(fetchImpl);
    const pending = client.searchNotices(REQUEST);
    const settled = pending.then(
      () => 'resolved' as const,
      (error: unknown) => error,
    );
    // Deterministic (random=0) delays: 1s, 2s, 4s, 8s between the 5 attempts.
    await vi.advanceTimersByTimeAsync(15_000 + 4 * 500);
    const outcome = await settled;
    expect(outcome).toBeInstanceOf(TedRequestError);
    const error = outcome as TedRequestError;
    expect(error.attempts).toBe(5);
    expect(error.status).toBe(500);
    expect(calls).toHaveLength(5);
    // Spacing between attempts follows 2^n growth (spacing floor is 500 ms).
    const gaps = calls.slice(1).map((call, i) => call.at - (calls[i]?.at ?? 0));
    expect(gaps).toEqual([1_000, 2_000, 4_000, 8_000]);
  });

  it('does not retry non-retryable statuses (400)', async () => {
    const { fetchImpl, calls } = makeFakeFetch([{ status: 400 }]);
    const client = makeClient(fetchImpl);
    await expect(client.searchNotices(REQUEST)).rejects.toMatchObject({
      name: 'TedRequestError',
      status: 400,
      attempts: 1,
    });
    expect(calls).toHaveLength(1);
  });

  it('throws TedBudgetExceededError once the per-run budget is spent (retries count)', async () => {
    const { fetchImpl, calls } = makeFakeFetch([
      { status: 200, body: searchBody() },
      { status: 200, body: searchBody() },
      { status: 200, body: searchBody() },
    ]);
    const client = makeClient(fetchImpl, { maxRequestsPerRun: 2 });
    await client.searchNotices(REQUEST);
    const second = client.searchNotices(REQUEST);
    await vi.advanceTimersByTimeAsync(500);
    await second;
    expect(client.requestsUsedThisRun).toBe(2);

    const third = client.searchNotices(REQUEST);
    const outcome = third.then(
      () => 'resolved' as const,
      (error: unknown) => error,
    );
    await vi.advanceTimersByTimeAsync(500);
    expect(await outcome).toBeInstanceOf(TedBudgetExceededError);
    expect(calls).toHaveLength(2); // no HTTP request was made for the third call
  });

  it('rejects a response that does not match the documented shape', async () => {
    const { fetchImpl } = makeFakeFetch([{ status: 200, body: { unexpected: true } }]);
    const client = makeClient(fetchImpl);
    await expect(client.searchNotices(REQUEST)).rejects.toMatchObject({
      name: 'TedRequestError',
      message: 'TED search response did not match the documented shape',
    });
  });
});

describe('TedClient.iterateSearch', () => {
  it('follows ITERATION tokens and terminates when the token disappears', async () => {
    const { fetchImpl, calls } = makeFakeFetch([
      { status: 200, body: searchBody({ token: 'token-1' }) },
      { status: 200, body: searchBody({ token: 'token-2' }) },
      { status: 200, body: searchBody() }, // no token → last page
    ]);
    const client = makeClient(fetchImpl);

    const pages: number[] = [];
    const run = (async () => {
      for await (const page of client.iterateSearch(REQUEST)) {
        pages.push(page.notices.length);
      }
    })();
    await vi.advanceTimersByTimeAsync(2_000);
    await run;

    expect(pages).toEqual([1, 1, 1]);
    expect(calls).toHaveLength(3);
    // Every request runs in ITERATION mode; tokens are threaded through.
    expect(
      calls.map((call) => (call.body as { iterationNextToken?: string }).iterationNextToken),
    ).toEqual([undefined, 'token-1', 'token-2']);
    expect(
      calls.every(
        (call) => (call.body as { paginationMode: string }).paginationMode === 'ITERATION',
      ),
    ).toBe(true);
  });

  it('terminates on an empty page even if a token is present', async () => {
    const { fetchImpl, calls } = makeFakeFetch([
      { status: 200, body: searchBody({ notices: [], token: 'token-1' }) },
    ]);
    const client = makeClient(fetchImpl);
    const pages: unknown[] = [];
    for await (const page of client.iterateSearch(REQUEST)) {
      pages.push(page);
    }
    expect(pages).toHaveLength(1);
    expect(calls).toHaveLength(1);
  });

  it('terminates when the API returns a token that never advances (stall guard)', async () => {
    const { fetchImpl, calls } = makeFakeFetch([
      { status: 200, body: searchBody({ token: 'stuck' }) },
      { status: 200, body: searchBody({ token: 'stuck' }) },
    ]);
    const client = makeClient(fetchImpl);
    const run = (async () => {
      let count = 0;
      for await (const _page of client.iterateSearch(REQUEST)) {
        count += 1;
      }
      return count;
    })();
    await vi.advanceTimersByTimeAsync(2_000);
    expect(await run).toBe(2);
    expect(calls).toHaveLength(2);
  });
});

describe('TedClient.fetchNoticeXml', () => {
  it('fetches XML from a ted.europa.eu https URL', async () => {
    const { fetchImpl, calls } = makeFakeFetch([{ status: 200, body: '<xml/>' }]);
    const client = makeClient(fetchImpl);
    const xml = await client.fetchNoticeXml('https://ted.europa.eu/en/notice/1-2026/xml');
    expect(xml).toBe('<xml/>');
    expect(calls[0]?.url).toBe('https://ted.europa.eu/en/notice/1-2026/xml');
  });

  it('identifies the client with Accept and User-Agent (ted.europa.eu serves an empty 200 without them)', async () => {
    const { fetchImpl, calls } = makeFakeFetch([{ status: 200, body: '<xml/>' }]);
    const client = makeClient(fetchImpl);
    await client.fetchNoticeXml('https://ted.europa.eu/en/notice/1-2026/xml');
    expect(calls[0]?.headers['Accept']).toContain('application/xml');
    expect(calls[0]?.headers['User-Agent']).toBe(TED_USER_AGENT);
    expect(TED_USER_AGENT).toContain('BidMorrow');
  });

  it('rejects an HTTP 200 response with an empty body as a failed fetch, not valid XML', async () => {
    // Fresh client per case — a second request on one client would park on
    // the 500 ms spacing sleep under fake timers.
    for (const emptyBody of ['', '  \n\t ']) {
      const { fetchImpl } = makeFakeFetch([{ status: 200, body: emptyBody }]);
      const client = makeClient(fetchImpl);
      await expect(
        client.fetchNoticeXml('https://ted.europa.eu/en/notice/1-2026/xml'),
      ).rejects.toMatchObject({ name: 'TedRequestError', status: 200 });
    }
  });

  it('refuses non-TED hosts and non-https URLs without spending budget', async () => {
    const { fetchImpl, calls } = makeFakeFetch([]);
    const client = makeClient(fetchImpl);
    await expect(client.fetchNoticeXml('https://evil.example/notice.xml')).rejects.toMatchObject({
      name: 'TedRequestError',
    });
    await expect(client.fetchNoticeXml('http://ted.europa.eu/notice.xml')).rejects.toMatchObject({
      name: 'TedRequestError',
    });
    // Suffix must be a domain boundary, not a substring match.
    await expect(
      client.fetchNoticeXml('https://not-ted.europa.eu.evil.example/x.xml'),
    ).rejects.toMatchObject({ name: 'TedRequestError' });
    expect(calls).toHaveLength(0);
    expect(client.requestsUsedThisRun).toBe(0);
  });

  it('rejects an oversized body declared by Content-Length before buffering it', async () => {
    const { fetchImpl, calls } = makeFakeFetch([
      { status: 200, body: 'irrelevant', headers: { 'Content-Length': '20000000' } },
    ]);
    const client = makeClient(fetchImpl);
    await expect(
      client.fetchNoticeXml('https://ted.europa.eu/en/notice/1-2026/xml'),
    ).rejects.toMatchObject({
      name: 'TedXmlTooLargeError',
      bytes: 20_000_000,
      maxBytes: 15_000_000,
    });
    expect(calls).toHaveLength(1); // the fetch itself still happens (retry budget aside)
  });

  it('rejects an oversized body even when Content-Length is absent or lies', async () => {
    const oversized = 'x'.repeat(15_000_001);
    const { fetchImpl } = makeFakeFetch([{ status: 200, body: oversized }]);
    const client = makeClient(fetchImpl);
    const error = await client
      .fetchNoticeXml('https://ted.europa.eu/en/notice/1-2026/xml')
      .catch((e: unknown) => e);
    expect(error).toBeInstanceOf(TedXmlTooLargeError);
    expect((error as TedXmlTooLargeError).bytes).toBe(15_000_001);
  });
});
