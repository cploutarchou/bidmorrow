/**
 * Resend email delivery (Phase 8, docs/dependency-versions.md: Resend 6.x is
 * fetch-based, Workers-compatible, batch ≤100/call, default rate limit 2
 * req/s).
 *
 * IMPLEMENTATION CHOICE: plain `fetch` against `api.resend.com/emails`
 * rather than the `resend` npm package. Justification: the package is a
 * thin fetch wrapper (per the same dependency-versions.md entry) — adding
 * it would pull in a dependency for what is, for our single-recipient
 * digest-send use case, one `POST` call with a JSON body and a bearer
 * token. A plain-fetch implementation is (a) trivially auditable against
 * the documented request/response shape, (b) has zero extra supply-chain
 * surface, and (c) avoids re-verifying an SDK's own Workers-runtime
 * compatibility on top of the fetch-based-and-compatible fact already
 * verified. If a future phase needs batch sending (≤100/call) or webhook
 * signature verification, revisit — those ARE meaningfully SDK-shaped
 * features, unlike a single send.
 *
 * SEC: the API key is passed in as a constructor argument and used only in
 * the `Authorization` header — never logged, never included in a thrown
 * error message. Error messages carry HTTP status only, never the response
 * body (which could echo back request fields).
 */

const RESEND_ENDPOINT = 'https://api.resend.com/emails';

/**
 * Resend's documented default rate limit (2 req/s) — sends within one
 * consumer invocation (a fresh provider instance per invocation, so this
 * state does not leak across invocations) are spaced ≥600ms apart.
 */
const MIN_SEND_SPACING_MS = 600;

export interface DigestSendMessage {
  readonly to: string;
  readonly kind: 'digest' | 'transactional';
  readonly subject: string;
  readonly html: string;
  readonly text: string;
}

export interface DigestSendResult {
  readonly providerMessageId: string;
}

/** Transient failure (5xx/429/network) — the caller should retry. */
export class RetryableEmailError extends Error {
  readonly retryable = true as const;
  constructor(
    message: string,
    readonly status?: number,
  ) {
    super(message);
    this.name = 'RetryableEmailError';
  }
}

/** Non-retryable failure (4xx other than 429) — retrying would not help. */
export class PermanentEmailError extends Error {
  readonly retryable = false as const;
  constructor(
    message: string,
    readonly status?: number,
  ) {
    super(message);
    this.name = 'PermanentEmailError';
  }
}

export interface DigestEmailProvider {
  send(message: DigestSendMessage): Promise<DigestSendResult>;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export interface CreateResendEmailProviderArgs {
  readonly apiKey: string;
  /** Verified sender, e.g. `BidMorrow <digest@bidmorrow.com>`. */
  readonly from: string;
  /** Injectable for tests; defaults to the global fetch. */
  readonly fetchImpl?: typeof fetch;
}

/**
 * Creates a Resend-backed provider. Sequential-per-instance rate limiting:
 * each `send` call waits out the remainder of `MIN_SEND_SPACING_MS` since
 * the previous call on the SAME instance — callers that want the spacing
 * guarantee must therefore `await` each send in turn (never
 * fire-and-forget — SEC-P4-08: digest sends run inside a queue consumer,
 * where awaiting is correct, unlike Better Auth's transactional-email hooks).
 */
export function createResendEmailProvider(
  args: CreateResendEmailProviderArgs,
): DigestEmailProvider {
  const fetchFn = args.fetchImpl ?? globalThis.fetch.bind(globalThis);
  let lastSendAt = 0;

  return {
    async send(message: DigestSendMessage): Promise<DigestSendResult> {
      const now = Date.now();
      if (lastSendAt !== 0) {
        const elapsed = now - lastSendAt;
        if (elapsed < MIN_SEND_SPACING_MS) {
          await sleep(MIN_SEND_SPACING_MS - elapsed);
        }
      }
      lastSendAt = Date.now();

      let response: Response;
      try {
        response = await fetchFn(RESEND_ENDPOINT, {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${args.apiKey}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            from: args.from,
            to: [message.to],
            subject: message.subject,
            html: message.html,
            text: message.text,
          }),
        });
      } catch (cause) {
        throw new RetryableEmailError(
          `resend request failed: ${cause instanceof Error ? cause.message : 'network error'}`,
        );
      }

      if (response.ok) {
        const body = (await response.json().catch(() => null)) as { id?: unknown } | null;
        if (body === null || typeof body.id !== 'string' || body.id.length === 0) {
          throw new RetryableEmailError('resend response missing a message id');
        }
        return { providerMessageId: body.id };
      }

      if (response.status === 429 || response.status >= 500) {
        throw new RetryableEmailError(
          `resend send failed (status ${response.status})`,
          response.status,
        );
      }
      throw new PermanentEmailError(
        `resend send failed (status ${response.status})`,
        response.status,
      );
    },
  };
}
