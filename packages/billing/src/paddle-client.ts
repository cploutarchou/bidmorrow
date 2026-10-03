/**
 * Minimal typed client for the Paddle Billing REST API (ADR-0011).
 *
 * Deliberately NOT `@paddle/paddle-node-sdk`: this package runs inside a
 * Cloudflare Worker, needs exactly five endpoints, and every call is plain
 * `fetch` + JSON with a Bearer key. A hand-written client keeps the Worker
 * bundle free of a Node-oriented dependency, makes every request shape
 * greppable in one file, and — like the previous `stripe-types.ts` seams —
 * lets unit tests inject a fake implementing only the slice a test needs.
 *
 * Verified against the official Paddle API reference (developer.paddle.com,
 * 2026-08-25; docs/dependency-versions.md § Paddle facts):
 *   GET   /subscriptions/{id}
 *   POST  /subscriptions/{id}/cancel        { effective_from }
 *   PATCH /subscriptions/{id}               { scheduled_change: null }
 *   POST  /transactions                     { items, custom_data, customer_id?, currency_code }
 *   GET   /transactions?customer_id=&status=&order_by=&per_page=
 *   GET   /transactions/{id}
 *   GET   /transactions/{id}/invoice        → { url }
 *   POST  /customers/{id}/portal-sessions   { subscription_ids? } → { urls.general.overview }
 * Bodies and responses are snake_case (Paddle convention); amounts are
 * strings in the currency's lowest unit; timestamps are RFC 3339 strings.
 */

export type PaddleEnvironment = 'sandbox' | 'production';

export const PADDLE_API_BASE: Record<PaddleEnvironment, string> = {
  sandbox: 'https://sandbox-api.paddle.com',
  production: 'https://api.paddle.com',
};

/** Subscription statuses Paddle can return (`subscription.status`). */
export type PaddleSubscriptionStatus = 'active' | 'canceled' | 'past_due' | 'paused' | 'trialing';

export interface PaddleBillingPeriod {
  readonly starts_at: string;
  readonly ends_at: string;
}

export interface PaddleScheduledChange {
  readonly action: 'cancel' | 'pause' | 'resume';
  readonly effective_at: string;
  readonly resume_at: string | null;
}

export interface PaddleSubscription {
  readonly id: string;
  readonly status: PaddleSubscriptionStatus | string;
  readonly customer_id: string;
  readonly custom_data: Readonly<Record<string, unknown>> | null;
  readonly current_billing_period: PaddleBillingPeriod | null;
  readonly next_billed_at: string | null;
  readonly scheduled_change: PaddleScheduledChange | null;
  readonly items: ReadonlyArray<{ readonly price: { readonly id: string } }>;
}

export type PaddleTransactionStatus =
  'draft' | 'ready' | 'billed' | 'paid' | 'completed' | 'canceled' | 'past_due';

export interface PaddleTransaction {
  readonly id: string;
  readonly status: PaddleTransactionStatus | string;
  readonly customer_id: string | null;
  readonly subscription_id: string | null;
  readonly invoice_number: string | null;
  readonly currency_code: string;
  readonly created_at: string;
  readonly billed_at: string | null;
  readonly billing_period: PaddleBillingPeriod | null;
  readonly details?: {
    readonly totals?: {
      readonly subtotal: string;
      readonly tax: string;
      readonly total: string;
      readonly grand_total: string;
      readonly currency_code: string;
    } | null;
  } | null;
}

export interface PaddleList<T> {
  readonly data: readonly T[];
  readonly meta: { readonly pagination?: { readonly has_more: boolean } | undefined };
}

export interface CreateTransactionBody {
  readonly items: ReadonlyArray<{ readonly price_id: string; readonly quantity: number }>;
  readonly custom_data: Readonly<Record<string, string>>;
  readonly currency_code: string;
  readonly customer_id?: string;
}

export interface ListTransactionsQuery {
  readonly customer_id: string;
  readonly status: readonly PaddleTransactionStatus[];
  readonly per_page: number;
  readonly order_by: string;
}

/** Slice used by the webhook processor (re-fetch, duplicate reconciliation). */
export interface SubscriptionsReadClient {
  get(subscriptionId: string): Promise<PaddleSubscription>;
  cancel(
    subscriptionId: string,
    body: { readonly effective_from: 'next_billing_period' | 'immediately' },
  ): Promise<PaddleSubscription>;
}

/** Slice used by cancellation.ts / reactivation.ts. */
export interface SubscriptionsScheduleClient {
  cancel(
    subscriptionId: string,
    body: { readonly effective_from: 'next_billing_period' | 'immediately' },
  ): Promise<PaddleSubscription>;
  /** Only ever `{ scheduled_change: null }` — Paddle's documented "remove a scheduled change" call. */
  update(
    subscriptionId: string,
    body: { readonly scheduled_change: null },
  ): Promise<PaddleSubscription>;
}

export interface TransactionsClient {
  create(body: CreateTransactionBody): Promise<PaddleTransaction>;
  get(transactionId: string): Promise<PaddleTransaction>;
  list(query: ListTransactionsQuery): Promise<PaddleList<PaddleTransaction>>;
  /** `GET /transactions/{id}/invoice` — a temporary URL to the invoice PDF. */
  invoice(transactionId: string): Promise<{ readonly url: string }>;
}

export interface PortalSessionsClient {
  create(
    customerId: string,
    body: { readonly subscription_ids?: readonly string[] },
  ): Promise<{ readonly urls: { readonly general: { readonly overview: string } } }>;
}

export interface PaddleClient {
  readonly subscriptions: SubscriptionsReadClient & SubscriptionsScheduleClient;
  readonly transactions: TransactionsClient;
  readonly customers: { readonly portalSessions: PortalSessionsClient };
}

/** Thrown on any non-2xx response. Message is safe to log; never echoed to a client verbatim. */
export class PaddleApiError extends Error {
  constructor(
    readonly status: number,
    readonly code: string | null,
    readonly requestId: string | null,
    detail: string,
  ) {
    super(`Paddle API ${status}${code !== null ? ` ${code}` : ''}: ${detail}`);
    this.name = 'PaddleApiError';
  }
}

export interface PaddleClientConfig {
  readonly apiKey: string;
  readonly environment: PaddleEnvironment;
  /** Injectable for tests; defaults to the global `fetch`. */
  readonly fetch?: typeof fetch;
}

interface PaddleEnvelope<T> {
  readonly data: T;
  readonly meta?: { readonly request_id?: string; readonly pagination?: { has_more: boolean } };
  readonly error?: { readonly code?: string; readonly detail?: string };
}

export function createPaddleClient(config: PaddleClientConfig): PaddleClient {
  const base = PADDLE_API_BASE[config.environment];
  const doFetch = config.fetch ?? fetch;

  async function call<T>(
    method: 'GET' | 'POST' | 'PATCH',
    path: string,
    body?: unknown,
  ): Promise<PaddleEnvelope<T>> {
    const response = await doFetch(`${base}${path}`, {
      method,
      headers: {
        authorization: `Bearer ${config.apiKey}`,
        accept: 'application/json',
        ...(body !== undefined ? { 'content-type': 'application/json' } : {}),
      },
      ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
    });
    const text = await response.text();
    let parsed: PaddleEnvelope<T> | null = null;
    try {
      parsed = text.length > 0 ? (JSON.parse(text) as PaddleEnvelope<T>) : null;
    } catch {
      parsed = null;
    }
    if (!response.ok) {
      throw new PaddleApiError(
        response.status,
        parsed?.error?.code ?? null,
        parsed?.meta?.request_id ?? null,
        parsed?.error?.detail ?? 'no detail',
      );
    }
    if (parsed === null) {
      throw new PaddleApiError(response.status, null, null, 'empty or non-JSON response body');
    }
    return parsed;
  }

  return {
    subscriptions: {
      async get(subscriptionId) {
        return (await call<PaddleSubscription>('GET', `/subscriptions/${subscriptionId}`)).data;
      },
      async cancel(subscriptionId, body) {
        return (
          await call<PaddleSubscription>('POST', `/subscriptions/${subscriptionId}/cancel`, body)
        ).data;
      },
      async update(subscriptionId, body) {
        return (await call<PaddleSubscription>('PATCH', `/subscriptions/${subscriptionId}`, body))
          .data;
      },
    },
    transactions: {
      async create(body) {
        return (await call<PaddleTransaction>('POST', '/transactions', body)).data;
      },
      async get(transactionId) {
        return (await call<PaddleTransaction>('GET', `/transactions/${transactionId}`)).data;
      },
      async list(query) {
        const params = new URLSearchParams({
          customer_id: query.customer_id,
          status: query.status.join(','),
          per_page: String(query.per_page),
          order_by: query.order_by,
        });
        const envelope = await call<readonly PaddleTransaction[]>(
          'GET',
          `/transactions?${params.toString()}`,
        );
        return {
          data: envelope.data,
          meta: { pagination: envelope.meta?.pagination },
        };
      },
      async invoice(transactionId) {
        return (await call<{ url: string }>('GET', `/transactions/${transactionId}/invoice`)).data;
      },
    },
    customers: {
      portalSessions: {
        async create(customerId, body) {
          return (
            await call<{ urls: { general: { overview: string } } }>(
              'POST',
              `/customers/${customerId}/portal-sessions`,
              body,
            )
          ).data;
        },
      },
    },
  };
}

/** RFC 3339 → epoch millis; `null` for a missing/unparseable value rather than `NaN`. */
export function paddleTimestampToMillis(value: string | null | undefined): number | null {
  if (value === null || value === undefined) return null;
  const millis = Date.parse(value);
  return Number.isFinite(millis) ? millis : null;
}

/** Lowest-unit amount string ("2900") → integer minor units; `null` when not an integer string. */
export function paddleAmountToMinorUnits(value: string | null | undefined): number | null {
  if (value === null || value === undefined || !/^-?\d+$/.test(value)) return null;
  return Number(value);
}
