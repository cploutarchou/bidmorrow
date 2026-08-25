/**
 * Organization provenance for Paddle `custom_data` (SEC-PDL-01).
 *
 * A Paddle webhook signature proves PADDLE sent the event — not that OUR
 * server created the transaction behind it. The Paddle.js client token is
 * public by design, so anyone on an approved domain can open
 * `Paddle.Checkout.open({ items, customData: { organization_id: X } })`
 * from devtools and mint a subscription whose `custom_data` we never
 * authored — bypassing every server-side checkout gate and, with a known
 * org id, griefing another tenant.
 *
 * Fix: the checkout transaction carries `custom_data.organization_sig` =
 * HMAC-SHA256(secret, organization_id). Paddle copies `custom_data`
 * verbatim onto the subscription and into every `subscription.*` event.
 * The webhook processor accepts an `organization_id` ONLY when its
 * signature verifies; anything else is `ignored`. Stateless, no schema
 * change, no extra API call, and unforgeable without the secret. The
 * secret is the notification-destination secret (`PADDLE_WEBHOOK_SECRET`)
 * — already required on both the checkout and webhook paths, and never
 * exposed to the browser.
 */

export const ORGANIZATION_ID_KEY = 'organization_id';
export const ORGANIZATION_SIG_KEY = 'organization_sig';

const encoder = new TextEncoder();

async function hmacHex(secret: string, message: string): Promise<string> {
  const key = await crypto.subtle.importKey(
    'raw',
    encoder.encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  );
  const mac = await crypto.subtle.sign('HMAC', key, encoder.encode(message));
  return Array.from(new Uint8Array(mac), (b) => b.toString(16).padStart(2, '0')).join('');
}

function timingSafeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i += 1) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

/** Signs an organization id for inclusion in transaction `custom_data`. */
export async function signOrganizationProvenance(
  secret: string,
  organizationId: string,
): Promise<string> {
  return hmacHex(secret, `bidmorrow-org:${organizationId}`);
}

/**
 * `true` only when `custom_data` carries a string `organization_id` AND a
 * matching `organization_sig`. Never throws on malformed input.
 */
export async function verifyOrganizationProvenance(
  secret: string,
  customData: Readonly<Record<string, unknown>> | null | undefined,
): Promise<boolean> {
  const organizationId = customData?.[ORGANIZATION_ID_KEY];
  const sig = customData?.[ORGANIZATION_SIG_KEY];
  if (typeof organizationId !== 'string' || organizationId.length === 0) return false;
  if (typeof sig !== 'string' || !/^[0-9a-f]{64}$/.test(sig)) return false;
  const expected = await signOrganizationProvenance(secret, organizationId);
  return timingSafeEqual(expected, sig);
}
