/**
 * Signature verification against the documented Paddle algorithm
 * (`ts=<unix>;h1=<hex HMAC-SHA256(secret, "ts:rawBody")>`), using the
 * package's own signer for round trips — no network, Web Crypto only.
 */
import { describe, expect, it } from 'vitest';

import {
  PADDLE_SIGNATURE_TOLERANCE_SECONDS,
  PaddleSignatureVerificationError,
  computePaddleSignature,
  parsePaddleSignatureHeader,
  signPaddleWebhook,
  verifyPaddleWebhook,
} from './webhook-signature';

const SECRET = 'pdl_ntfset_test_secret';
const NOW = 1_800_000_000;
const BODY = JSON.stringify({
  event_id: 'evt_01test',
  event_type: 'subscription.updated',
  occurred_at: '2026-08-25T10:00:00.000Z',
  data: { id: 'sub_01test' },
});

async function reason(promise: Promise<unknown>): Promise<string> {
  try {
    await promise;
    return 'no error';
  } catch (cause) {
    expect(cause).toBeInstanceOf(PaddleSignatureVerificationError);
    return (cause as PaddleSignatureVerificationError).reason;
  }
}

describe('parsePaddleSignatureHeader', () => {
  const H1 = 'a'.repeat(64);

  it('parses the documented shape', () => {
    expect(parsePaddleSignatureHeader(`ts=${NOW};h1=${H1}`)).toEqual({ ts: NOW, h1: [H1] });
  });

  it('is tolerant of key order, whitespace and uppercase hex', () => {
    expect(parsePaddleSignatureHeader(` h1=${H1.toUpperCase()} ; ts=${NOW} `)).toEqual({
      ts: NOW,
      h1: [H1],
    });
  });

  it('ignores unknown keys (forward compatibility)', () => {
    expect(parsePaddleSignatureHeader(`ts=${NOW};h1=${H1};h2=${H1}`)).toEqual({
      ts: NOW,
      h1: [H1],
    });
  });

  it('collects every h1 value (secret-rotation window sends several)', () => {
    const other = H1.replace(/^./, (c) => (c === '0' ? '1' : '0'));
    expect(parsePaddleSignatureHeader(`ts=${NOW};h1=${other};h1=${H1}`)).toEqual({
      ts: NOW,
      h1: [other, H1],
    });
  });

  it('rejects malformed headers', () => {
    expect(parsePaddleSignatureHeader('')).toBeNull();
    expect(parsePaddleSignatureHeader(`ts=${NOW}`)).toBeNull();
    expect(parsePaddleSignatureHeader(`h1=${H1}`)).toBeNull();
    expect(parsePaddleSignatureHeader(`ts=abc;h1=${H1}`)).toBeNull();
    expect(parsePaddleSignatureHeader(`ts=${NOW};h1=zz`)).toBeNull();
    expect(parsePaddleSignatureHeader(`ts=${NOW};=${H1}`)).toBeNull();
    expect(parsePaddleSignatureHeader(`garbage`)).toBeNull();
  });
});

describe('computePaddleSignature / signPaddleWebhook', () => {
  it('is deterministic and hex-encoded', async () => {
    const a = await computePaddleSignature(SECRET, NOW, BODY);
    const b = await computePaddleSignature(SECRET, NOW, BODY);
    expect(a).toBe(b);
    expect(a).toMatch(/^[0-9a-f]{64}$/);
    expect(await signPaddleWebhook(SECRET, BODY, NOW)).toBe(`ts=${NOW};h1=${a}`);
  });
});

describe('verifyPaddleWebhook', () => {
  it('round-trips a freshly signed body and returns the parsed event', async () => {
    const header = await signPaddleWebhook(SECRET, BODY, NOW);
    const event = await verifyPaddleWebhook(BODY, header, SECRET, { nowSeconds: NOW });
    expect(event).toMatchObject({
      event_id: 'evt_01test',
      event_type: 'subscription.updated',
      data: { id: 'sub_01test' },
    });
  });

  it('verifies when ANY h1 matches (rotation) and rejects when none does', async () => {
    const good = await computePaddleSignature(SECRET, NOW, BODY);
    const bad = await computePaddleSignature('rotated-away', NOW, BODY);
    const event = await verifyPaddleWebhook(BODY, `ts=${NOW};h1=${bad};h1=${good}`, SECRET, {
      nowSeconds: NOW,
    });
    expect(event.event_id).toBe('evt_01test');
    expect(
      await reason(
        verifyPaddleWebhook(BODY, `ts=${NOW};h1=${bad};h1=${bad}`, SECRET, { nowSeconds: NOW }),
      ),
    ).toBe('mismatch');
  });

  it('rejects a malformed header', async () => {
    expect(await reason(verifyPaddleWebhook(BODY, 'nope', SECRET, { nowSeconds: NOW }))).toBe(
      'malformed_header',
    );
  });

  it('rejects a tampered body (mismatch)', async () => {
    const header = await signPaddleWebhook(SECRET, BODY, NOW);
    const tampered = BODY.replace('sub_01test', 'sub_01evil');
    expect(await reason(verifyPaddleWebhook(tampered, header, SECRET, { nowSeconds: NOW }))).toBe(
      'mismatch',
    );
  });

  it('rejects even a whitespace-only change to the body', async () => {
    const header = await signPaddleWebhook(SECRET, BODY, NOW);
    expect(await reason(verifyPaddleWebhook(`${BODY} `, header, SECRET, { nowSeconds: NOW }))).toBe(
      'mismatch',
    );
  });

  it('rejects a wrong secret (mismatch)', async () => {
    const header = await signPaddleWebhook('pdl_ntfset_other', BODY, NOW);
    expect(await reason(verifyPaddleWebhook(BODY, header, SECRET, { nowSeconds: NOW }))).toBe(
      'mismatch',
    );
  });

  it('rejects a timestamp outside the tolerance in either direction, before checking the MAC', async () => {
    const stale = await signPaddleWebhook(
      SECRET,
      BODY,
      NOW - PADDLE_SIGNATURE_TOLERANCE_SECONDS - 1,
    );
    expect(await reason(verifyPaddleWebhook(BODY, stale, SECRET, { nowSeconds: NOW }))).toBe(
      'expired',
    );
    const future = await signPaddleWebhook(
      SECRET,
      BODY,
      NOW + PADDLE_SIGNATURE_TOLERANCE_SECONDS + 1,
    );
    expect(await reason(verifyPaddleWebhook(BODY, future, SECRET, { nowSeconds: NOW }))).toBe(
      'expired',
    );
    // Wrong secret AND stale: the cheap timestamp check wins.
    const staleWrong = await signPaddleWebhook('x', BODY, NOW - 10_000);
    expect(await reason(verifyPaddleWebhook(BODY, staleWrong, SECRET, { nowSeconds: NOW }))).toBe(
      'expired',
    );
  });

  it('accepts a timestamp exactly at the tolerance boundary and honours a custom tolerance', async () => {
    const edge = await signPaddleWebhook(SECRET, BODY, NOW - PADDLE_SIGNATURE_TOLERANCE_SECONDS);
    await expect(
      verifyPaddleWebhook(BODY, edge, SECRET, { nowSeconds: NOW }),
    ).resolves.toBeDefined();
    const header = await signPaddleWebhook(SECRET, BODY, NOW - 30);
    expect(
      await reason(
        verifyPaddleWebhook(BODY, header, SECRET, { nowSeconds: NOW, toleranceSeconds: 5 }),
      ),
    ).toBe('expired');
  });

  it('rejects a correctly signed non-JSON body (invalid_body)', async () => {
    const body = 'not json';
    const header = await signPaddleWebhook(SECRET, body, NOW);
    expect(await reason(verifyPaddleWebhook(body, header, SECRET, { nowSeconds: NOW }))).toBe(
      'invalid_body',
    );
  });

  it('rejects a correctly signed body without the event envelope (invalid_body)', async () => {
    for (const body of [
      JSON.stringify({ event_type: 'subscription.updated', occurred_at: 'x', data: {} }),
      JSON.stringify({
        event_id: '',
        event_type: 'subscription.updated',
        occurred_at: 'x',
        data: {},
      }),
      JSON.stringify({ event_id: 'evt', occurred_at: 'x', data: {} }),
      JSON.stringify({ event_id: 'evt', event_type: 'x', occurred_at: 'x' }),
      JSON.stringify([]),
      'null',
    ]) {
      const header = await signPaddleWebhook(SECRET, body, NOW);
      expect(await reason(verifyPaddleWebhook(body, header, SECRET, { nowSeconds: NOW }))).toBe(
        'invalid_body',
      );
    }
  });

  it('defaults "now" to the wall clock', async () => {
    const header = await signPaddleWebhook(SECRET, BODY);
    await expect(verifyPaddleWebhook(BODY, header, SECRET)).resolves.toBeDefined();
  });
});
