/**
 * `createPaddleClient` against an injected `fetch` — asserts the exact
 * request shapes (URL, method, headers, body/query) and the error contract,
 * with no network.
 */
import { describe, expect, it, vi } from 'vitest';

import {
  PADDLE_API_BASE,
  PaddleApiError,
  createPaddleClient,
  paddleAmountToMinorUnits,
  paddleTimestampToMillis,
} from './paddle-client';

type Call = { url: string; init: RequestInit };

function fakeFetch(
  responder: (call: Call) => { status?: number; body?: unknown; raw?: string } = () => ({}),
) {
  const calls: Call[] = [];
  const fetchImpl = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const call = { url: String(input), init: init ?? {} };
    calls.push(call);
    const r = responder(call);
    const status = r.status ?? 200;
    const text = r.raw ?? JSON.stringify(r.body ?? { data: { id: 'ok' } });
    return new Response(text, { status });
  });
  return { fetchImpl: fetchImpl as unknown as typeof fetch, calls };
}

describe('createPaddleClient', () => {
  it('targets the sandbox base with a Bearer key and JSON accept header', async () => {
    const { fetchImpl, calls } = fakeFetch(() => ({ body: { data: { id: 'sub_1' } } }));
    const client = createPaddleClient({
      apiKey: 'pdl_sdbx_x',
      environment: 'sandbox',
      fetch: fetchImpl,
    });
    const sub = await client.subscriptions.get('sub_1');
    expect(sub).toEqual({ id: 'sub_1' });
    expect(calls[0]?.url).toBe(`${PADDLE_API_BASE.sandbox}/subscriptions/sub_1`);
    expect(calls[0]?.init.method).toBe('GET');
    expect(calls[0]?.init.headers).toMatchObject({
      authorization: 'Bearer pdl_sdbx_x',
      accept: 'application/json',
    });
    expect(calls[0]?.init.headers).not.toHaveProperty('content-type');
    expect(calls[0]?.init.body).toBeUndefined();
  });

  it('targets the production base for the production environment', async () => {
    const { fetchImpl, calls } = fakeFetch();
    const client = createPaddleClient({ apiKey: 'k', environment: 'production', fetch: fetchImpl });
    await client.subscriptions.get('sub_1');
    expect(calls[0]?.url).toBe('https://api.paddle.com/subscriptions/sub_1');
    expect(PADDLE_API_BASE.production).toBe('https://api.paddle.com');
  });

  it('POSTs JSON bodies with content-type (cancel, transactions.create, portal sessions)', async () => {
    const { fetchImpl, calls } = fakeFetch(({ url }) =>
      url.endsWith('/portal-sessions')
        ? { body: { data: { urls: { general: { overview: 'https://portal' } } } } }
        : { body: { data: { id: 'x' } } },
    );
    const client = createPaddleClient({ apiKey: 'k', environment: 'sandbox', fetch: fetchImpl });

    await client.subscriptions.cancel('sub_1', { effective_from: 'next_billing_period' });
    expect(calls[0]).toMatchObject({
      url: `${PADDLE_API_BASE.sandbox}/subscriptions/sub_1/cancel`,
      init: { method: 'POST', body: JSON.stringify({ effective_from: 'next_billing_period' }) },
    });
    expect(calls[0]?.init.headers).toMatchObject({ 'content-type': 'application/json' });

    const txBody = {
      items: [{ price_id: 'pri_1', quantity: 1 }],
      custom_data: { organization_id: 'org_1', plan: 'standard' },
      currency_code: 'EUR',
    };
    await client.transactions.create(txBody);
    expect(calls[1]).toMatchObject({
      url: `${PADDLE_API_BASE.sandbox}/transactions`,
      init: { method: 'POST', body: JSON.stringify(txBody) },
    });

    const portal = await client.customers.portalSessions.create('ctm_1', {
      subscription_ids: ['sub_1'],
    });
    expect(portal.urls.general.overview).toBe('https://portal');
    expect(calls[2]).toMatchObject({
      url: `${PADDLE_API_BASE.sandbox}/customers/ctm_1/portal-sessions`,
      init: { method: 'POST', body: JSON.stringify({ subscription_ids: ['sub_1'] }) },
    });
  });

  it('PATCHes the scheduled-change removal', async () => {
    const { fetchImpl, calls } = fakeFetch();
    const client = createPaddleClient({ apiKey: 'k', environment: 'sandbox', fetch: fetchImpl });
    await client.subscriptions.update('sub_1', { scheduled_change: null });
    expect(calls[0]).toMatchObject({
      url: `${PADDLE_API_BASE.sandbox}/subscriptions/sub_1`,
      init: { method: 'PATCH', body: JSON.stringify({ scheduled_change: null }) },
    });
  });

  it('builds the transactions list query string (statuses comma-joined) and returns pagination', async () => {
    const { fetchImpl, calls } = fakeFetch(() => ({
      body: { data: [{ id: 'txn_1' }], meta: { pagination: { has_more: true } } },
    }));
    const client = createPaddleClient({ apiKey: 'k', environment: 'sandbox', fetch: fetchImpl });
    const page = await client.transactions.list({
      customer_id: 'ctm_1',
      status: ['billed', 'paid'],
      per_page: 24,
      order_by: 'billed_at[DESC]',
    });
    const url = new URL(calls[0]?.url ?? '');
    expect(url.pathname).toBe('/transactions');
    expect(url.searchParams.get('customer_id')).toBe('ctm_1');
    expect(url.searchParams.get('status')).toBe('billed,paid');
    expect(url.searchParams.get('per_page')).toBe('24');
    expect(url.searchParams.get('order_by')).toBe('billed_at[DESC]');
    expect(page.data).toEqual([{ id: 'txn_1' }]);
    expect(page.meta.pagination).toEqual({ has_more: true });
  });

  it('fetches a transaction and its invoice url', async () => {
    const { fetchImpl, calls } = fakeFetch(({ url }) =>
      url.endsWith('/invoice')
        ? { body: { data: { url: 'https://pdf' } } }
        : { body: { data: { id: 'txn_1' } } },
    );
    const client = createPaddleClient({ apiKey: 'k', environment: 'sandbox', fetch: fetchImpl });
    expect(await client.transactions.get('txn_1')).toEqual({ id: 'txn_1' });
    expect(await client.transactions.invoice('txn_1')).toEqual({ url: 'https://pdf' });
    expect(calls.map((c) => c.url)).toEqual([
      `${PADDLE_API_BASE.sandbox}/transactions/txn_1`,
      `${PADDLE_API_BASE.sandbox}/transactions/txn_1/invoice`,
    ]);
  });

  it('throws PaddleApiError with status/code/requestId on a non-2xx response', async () => {
    const { fetchImpl } = fakeFetch(() => ({
      status: 404,
      body: {
        error: { type: 'request_error', code: 'entity_not_found', detail: 'no such thing' },
        meta: { request_id: 'req_123' },
      },
    }));
    const client = createPaddleClient({ apiKey: 'k', environment: 'sandbox', fetch: fetchImpl });
    const error = await client.subscriptions.get('sub_missing').catch((cause: unknown) => cause);
    expect(error).toBeInstanceOf(PaddleApiError);
    const apiError = error as PaddleApiError;
    expect(apiError.status).toBe(404);
    expect(apiError.code).toBe('entity_not_found');
    expect(apiError.requestId).toBe('req_123');
    expect(apiError.message).toContain('404');
    expect(apiError.message).toContain('entity_not_found');
  });

  it('throws PaddleApiError with null code/requestId on a non-JSON error body', async () => {
    const { fetchImpl } = fakeFetch(() => ({ status: 502, raw: '<html>bad gateway</html>' }));
    const client = createPaddleClient({ apiKey: 'k', environment: 'sandbox', fetch: fetchImpl });
    const error = (await client.subscriptions.get('s').catch((c: unknown) => c)) as PaddleApiError;
    expect(error).toBeInstanceOf(PaddleApiError);
    expect(error.status).toBe(502);
    expect(error.code).toBeNull();
    expect(error.requestId).toBeNull();
  });

  it('throws PaddleApiError on a 2xx with an empty or non-JSON body', async () => {
    const { fetchImpl } = fakeFetch(({ url }) =>
      url.endsWith('/sub_empty') ? { status: 200, raw: '' } : { status: 200, raw: 'not json' },
    );
    const client = createPaddleClient({ apiKey: 'k', environment: 'sandbox', fetch: fetchImpl });
    await expect(client.subscriptions.get('sub_empty')).rejects.toBeInstanceOf(PaddleApiError);
    await expect(client.subscriptions.get('sub_text')).rejects.toBeInstanceOf(PaddleApiError);
  });
});

describe('paddleTimestampToMillis', () => {
  it('parses RFC 3339 and returns null for missing/unparseable values', () => {
    expect(paddleTimestampToMillis('2026-08-25T10:00:00.000Z')).toBe(
      Date.parse('2026-08-25T10:00:00.000Z'),
    );
    expect(paddleTimestampToMillis(null)).toBeNull();
    expect(paddleTimestampToMillis(undefined)).toBeNull();
    expect(paddleTimestampToMillis('not a date')).toBeNull();
    expect(paddleTimestampToMillis('')).toBeNull();
  });
});

describe('paddleAmountToMinorUnits', () => {
  it('parses integer strings (incl. negative) and rejects everything else', () => {
    expect(paddleAmountToMinorUnits('2900')).toBe(2900);
    expect(paddleAmountToMinorUnits('0')).toBe(0);
    expect(paddleAmountToMinorUnits('-500')).toBe(-500);
    expect(paddleAmountToMinorUnits('29.00')).toBeNull();
    expect(paddleAmountToMinorUnits('abc')).toBeNull();
    expect(paddleAmountToMinorUnits('')).toBeNull();
    expect(paddleAmountToMinorUnits(null)).toBeNull();
    expect(paddleAmountToMinorUnits(undefined)).toBeNull();
  });
});
