/**
 * Paddle webhook signature verification — Web Crypto only (Workers has no
 * Node `crypto`), no SDK.
 *
 * Algorithm (developer.paddle.com/webhooks/about/signature-verification,
 * verified 2026-08-25): the `Paddle-Signature` header is
 * `ts=<unix seconds>;h1=<hex hmac>`; the signed payload is
 * `${ts}:${rawBody}` (raw bytes — never re-serialized); the MAC is
 * HMAC-SHA256 keyed with the notification destination's secret
 * (`pdl_ntfset_…`); compare in constant time.
 *
 * Replay window: the official SDKs default to a 5-SECOND tolerance. We
 * use 5 MINUTES — generous against clock skew between Paddle and the edge,
 * and safe because replaying a signed event is already a guaranteed no-op
 * downstream: `processPaddleEvent` dedups on the unique `event_id`
 * (docs/threat-model.md T11).
 */

export class PaddleSignatureVerificationError extends Error {
  constructor(readonly reason: 'malformed_header' | 'expired' | 'mismatch' | 'invalid_body') {
    super(`Paddle webhook signature verification failed: ${reason}`);
    this.name = 'PaddleSignatureVerificationError';
  }
}

export const PADDLE_SIGNATURE_TOLERANCE_SECONDS = 5 * 60;

export interface PaddleEvent<TData = unknown> {
  readonly event_id: string;
  readonly event_type: string;
  readonly occurred_at: string;
  readonly notification_id?: string;
  readonly data: TData;
}

export interface ParsedPaddleSignature {
  readonly ts: number;
  /** One or more signatures — Paddle sends several while a destination secret is being rotated. */
  readonly h1: readonly string[];
}

/** Pure header parse — exported for unit tests; tolerant of key order, strict on shape. */
export function parsePaddleSignatureHeader(header: string): ParsedPaddleSignature | null {
  const parts = header.split(';').map((p) => p.trim());
  let ts: number | null = null;
  const h1: string[] = [];
  for (const part of parts) {
    const eq = part.indexOf('=');
    if (eq <= 0) return null;
    const key = part.slice(0, eq);
    const value = part.slice(eq + 1);
    if (key === 'ts') {
      if (!/^\d+$/.test(value)) return null;
      ts = Number(value);
    } else if (key === 'h1') {
      if (!/^[0-9a-f]{64}$/i.test(value)) return null;
      h1.push(value.toLowerCase());
    }
    // Unknown keys are ignored (forward compatibility), never fatal.
  }
  if (ts === null || h1.length === 0) return null;
  return { ts, h1 };
}

function hex(bytes: ArrayBuffer): string {
  return Array.from(new Uint8Array(bytes), (b) => b.toString(16).padStart(2, '0')).join('');
}

function timingSafeEqualHex(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i += 1) {
    diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  }
  return diff === 0;
}

export async function computePaddleSignature(
  secret: string,
  ts: number,
  rawBody: string,
): Promise<string> {
  const encoder = new TextEncoder();
  const key = await crypto.subtle.importKey(
    'raw',
    encoder.encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  );
  const mac = await crypto.subtle.sign('HMAC', key, encoder.encode(`${ts}:${rawBody}`));
  return hex(mac);
}

/** Test helper + simulator parity: builds a header exactly as Paddle would. */
export async function signPaddleWebhook(
  secret: string,
  rawBody: string,
  ts: number = Math.floor(Date.now() / 1000),
): Promise<string> {
  return `ts=${ts};h1=${await computePaddleSignature(secret, ts, rawBody)}`;
}

export interface VerifyOptions {
  /** Epoch seconds "now" — injectable for tests. */
  readonly nowSeconds?: number;
  readonly toleranceSeconds?: number;
}

/**
 * Verifies and parses one webhook delivery. Throws
 * {@link PaddleSignatureVerificationError}; callers respond 400 with NO
 * detail (never echo the reason to the caller — docs/security.md C9).
 */
export async function verifyPaddleWebhook(
  rawBody: string,
  signatureHeader: string,
  secret: string,
  options: VerifyOptions = {},
): Promise<PaddleEvent> {
  const parsed = parsePaddleSignatureHeader(signatureHeader);
  if (parsed === null) throw new PaddleSignatureVerificationError('malformed_header');

  const now = options.nowSeconds ?? Math.floor(Date.now() / 1000);
  const tolerance = options.toleranceSeconds ?? PADDLE_SIGNATURE_TOLERANCE_SECONDS;
  if (Math.abs(now - parsed.ts) > tolerance) {
    throw new PaddleSignatureVerificationError('expired');
  }

  const expected = await computePaddleSignature(secret, parsed.ts, rawBody);
  // Any matching h1 is sufficient (secret rotation window); every
  // candidate is compared in constant time.
  let matched = false;
  for (const candidate of parsed.h1) {
    matched = timingSafeEqualHex(expected, candidate) || matched;
  }
  if (!matched) {
    throw new PaddleSignatureVerificationError('mismatch');
  }

  let event: unknown;
  try {
    event = JSON.parse(rawBody);
  } catch {
    throw new PaddleSignatureVerificationError('invalid_body');
  }
  if (!isPaddleEventShape(event)) throw new PaddleSignatureVerificationError('invalid_body');
  return event;
}

function isPaddleEventShape(value: unknown): value is PaddleEvent {
  if (typeof value !== 'object' || value === null) return false;
  const v = value as Record<string, unknown>;
  return (
    typeof v['event_id'] === 'string' &&
    v['event_id'].length > 0 &&
    typeof v['event_type'] === 'string' &&
    typeof v['occurred_at'] === 'string' &&
    'data' in v
  );
}
