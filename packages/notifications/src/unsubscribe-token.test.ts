import { describe, expect, it } from 'vitest';

import {
  signUnsubscribeToken,
  unsubscribeUrlFor,
  verifyUnsubscribeToken,
} from './unsubscribe-token';

const SECRET = 'test-secret-value';
const PAYLOAD = { organizationId: 'org_123', email: 'someone@example.test' } as const;

describe('unsubscribe tokens', () => {
  it('round-trips a payload', async () => {
    const token = await signUnsubscribeToken(SECRET, PAYLOAD);
    expect(await verifyUnsubscribeToken(SECRET, token)).toEqual(PAYLOAD);
  });

  it('is deterministic for the same secret and payload', async () => {
    expect(await signUnsubscribeToken(SECRET, PAYLOAD)).toBe(
      await signUnsubscribeToken(SECRET, PAYLOAD),
    );
  });

  it('rejects a token signed with a different secret (secret rotation revokes)', async () => {
    const token = await signUnsubscribeToken(SECRET, PAYLOAD);
    expect(await verifyUnsubscribeToken('a-different-secret', token)).toBeNull();
  });

  it('rejects a tampered payload — the org id cannot be swapped', async () => {
    const token = await signUnsubscribeToken(SECRET, PAYLOAD);
    const forgedPayload = btoa(JSON.stringify({ o: 'org_victim', e: PAYLOAD.email }))
      .replace(/\+/g, '-')
      .replace(/\//g, '_')
      .replace(/=+$/, '');
    const forged = `${forgedPayload}.${token.slice(token.indexOf('.') + 1)}`;
    expect(await verifyUnsubscribeToken(SECRET, forged)).toBeNull();
  });

  it('rejects malformed shapes without throwing', async () => {
    for (const bad of [
      '',
      '.',
      'nodot',
      'payload.',
      '.mac',
      'payload.nothex',
      `payload.${'z'.repeat(64)}`,
      'payload.abc',
      `!!!not-base64!!!.${'a'.repeat(64)}`,
    ]) {
      expect(await verifyUnsubscribeToken(SECRET, bad)).toBeNull();
    }
  });

  // Signs an arbitrary encoded payload with the REAL key, reproducing the
  // module's own message construction, so these tokens pass the MAC check
  // and the field validation is genuinely what rejects them. Without this
  // the assertion would pass for the wrong reason (a MAC mismatch).
  async function signRawPayload(encoded: string): Promise<string> {
    const key = await crypto.subtle.importKey(
      'raw',
      new TextEncoder().encode(SECRET),
      { name: 'HMAC', hash: 'SHA-256' },
      false,
      ['sign'],
    );
    const mac = await crypto.subtle.sign(
      'HMAC',
      key,
      new TextEncoder().encode(`bidmorrow-unsub:v1:${encoded}`),
    );
    const hex = Array.from(new Uint8Array(mac), (b) => b.toString(16).padStart(2, '0')).join('');
    return `${encoded}.${hex}`;
  }

  function encodePayload(value: unknown): string {
    return btoa(JSON.stringify(value)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  }

  it('rejects a validly-signed token whose payload is not the expected shape', async () => {
    // Guards the decode path against trusting any blob that carries a good
    // MAC — a signed token is still parsed and field-checked.
    for (const bad of [
      { o: 42, e: 'a@b.test' },
      { o: 'org_1', e: null },
      { o: '', e: 'a@b.test' },
      { o: 'org_1', e: '' },
      { o: 'org_1' },
      {},
      null,
      'a string',
      [1, 2, 3],
    ]) {
      const token = await signRawPayload(encodePayload(bad));
      expect(await verifyUnsubscribeToken(SECRET, token)).toBeNull();
    }
  });

  it('rejects a validly-signed token whose payload is not JSON at all', async () => {
    const encoded = btoa('not json').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
    expect(await verifyUnsubscribeToken(SECRET, await signRawPayload(encoded))).toBeNull();
  });

  it('builds an absolute URL with the token percent-encoded', () => {
    const url = unsubscribeUrlFor('https://app.bidmorrow.com', 'abc.def+/=');
    expect(url).toBe('https://app.bidmorrow.com/api/digest/unsubscribe?token=abc.def%2B%2F%3D');
  });
});
