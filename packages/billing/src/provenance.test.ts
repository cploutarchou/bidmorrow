/**
 * `provenance.ts` — the HMAC that proves OUR server created the checkout
 * transaction behind a `subscription.*` event (SEC-PDL-01). Pure Web
 * Crypto, no network.
 */
import { describe, expect, it } from 'vitest';

import {
  ORGANIZATION_ID_KEY,
  ORGANIZATION_SIG_KEY,
  signOrganizationProvenance,
  verifyOrganizationProvenance,
} from './provenance';

const SECRET = 'pdl_ntfset_test_secret';
const ORG = 'org_01J0PROVENANCE';

describe('signOrganizationProvenance', () => {
  it('is deterministic 64-char lowercase hex, and differs per org and per secret', async () => {
    const a = await signOrganizationProvenance(SECRET, ORG);
    expect(a).toMatch(/^[0-9a-f]{64}$/);
    expect(await signOrganizationProvenance(SECRET, ORG)).toBe(a);
    expect(await signOrganizationProvenance(SECRET, 'org_other')).not.toBe(a);
    expect(await signOrganizationProvenance('other-secret', ORG)).not.toBe(a);
  });

  it('exposes the custom_data key names used by checkout and webhook', () => {
    expect(ORGANIZATION_ID_KEY).toBe('organization_id');
    expect(ORGANIZATION_SIG_KEY).toBe('organization_sig');
  });
});

describe('verifyOrganizationProvenance', () => {
  it('round-trips a signed custom_data object (extra keys allowed)', async () => {
    const sig = await signOrganizationProvenance(SECRET, ORG);
    expect(
      await verifyOrganizationProvenance(SECRET, {
        organization_id: ORG,
        organization_sig: sig,
        plan: 'standard',
      }),
    ).toBe(true);
  });

  it('rejects a wrong secret, a different org, and a tampered signature', async () => {
    const sig = await signOrganizationProvenance(SECRET, ORG);
    expect(
      await verifyOrganizationProvenance('wrong', { organization_id: ORG, organization_sig: sig }),
    ).toBe(false);
    expect(
      await verifyOrganizationProvenance(SECRET, {
        organization_id: 'org_victim',
        organization_sig: sig,
      }),
    ).toBe(false);
    const flipped = (sig[0] === 'a' ? 'b' : 'a') + sig.slice(1);
    expect(
      await verifyOrganizationProvenance(SECRET, {
        organization_id: ORG,
        organization_sig: flipped,
      }),
    ).toBe(false);
    // Uppercase hex is not accepted — the signer only ever emits lowercase.
    expect(
      await verifyOrganizationProvenance(SECRET, {
        organization_id: ORG,
        organization_sig: sig.toUpperCase(),
      }),
    ).toBe(false);
  });

  it('is false (never throws) for missing keys, non-strings, empty ids and malformed hex', async () => {
    const sig = await signOrganizationProvenance(SECRET, ORG);
    for (const customData of [
      null,
      undefined,
      {},
      { organization_id: ORG },
      { organization_sig: sig },
      { organization_id: '', organization_sig: sig },
      { organization_id: 42, organization_sig: sig },
      { organization_id: ORG, organization_sig: 42 },
      { organization_id: ORG, organization_sig: 'zz' },
      { organization_id: ORG, organization_sig: sig.slice(0, 63) },
      { organization_id: ORG, organization_sig: `${sig}0` },
    ]) {
      expect(await verifyOrganizationProvenance(SECRET, customData as never)).toBe(false);
    }
  });
});
