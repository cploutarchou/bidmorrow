/**
 * Signed digest-unsubscribe tokens (F-08, PRODUCTION_READINESS_AUDIT.md).
 *
 * The daily digest previously offered only a "Manage digest preferences"
 * link into `/app/settings`, which requires a session. A recipient who
 * cannot or will not log in had no way to stop the mail, and RFC 8058
 * one-click unsubscribe was impossible because there was no unauthenticated
 * endpoint to point `List-Unsubscribe` at.
 *
 * A token is `base64url(payload) "." hex(HMAC-SHA256)`, signed with
 * `BETTER_AUTH_SECRET` under an explicit purpose prefix
 * (`bidmorrow-unsub:v1:`) so a token minted here can never be replayed
 * against another HMAC surface keyed with the same secret, and vice versa —
 * the same domain-separation reasoning as `@bidmorrow/billing`'s
 * `provenance.ts`. Stateless: no table, no cleanup job, and nothing to keep
 * in sync with `digest_preferences`.
 *
 * DELIBERATELY NO EXPIRY. An unsubscribe link must keep working in a
 * message someone finds months later — an expired one is exactly the
 * "unsubscribe didn't work" experience the header exists to prevent, and
 * the capability it grants (turning a digest OFF) is not one an attacker
 * gains anything by holding. Rotating `BETTER_AUTH_SECRET` invalidates
 * every outstanding token, which is the intended and only revocation.
 *
 * The email is carried in the payload — RFC 8058 §3 wants the URI to
 * identify both the recipient and the list — but it is the ORGANIZATION's
 * digest that gets disabled, because `digest_preferences` is org-scoped
 * (one row per organization, no per-member column). Today that distinction
 * is invisible: there is no invite flow, so every organization has exactly
 * one member. If team invites ever land, this becomes a real difference and
 * a per-recipient suppression table is needed — see the note in
 * `digest-orchestration.ts` and F-09 in the audit.
 */

const PURPOSE = 'bidmorrow-unsub:v1:';

const encoder = new TextEncoder();

export interface UnsubscribeTokenPayload {
  readonly organizationId: string;
  /** The address the message was sent to; recorded for the audit trail. */
  readonly email: string;
}

function base64urlEncode(bytes: Uint8Array): string {
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function base64urlDecode(value: string): Uint8Array | null {
  if (!/^[A-Za-z0-9_-]+$/.test(value)) return null;
  const padded = value.replace(/-/g, '+').replace(/_/g, '/');
  try {
    const binary = atob(padded);
    return Uint8Array.from(binary, (char) => char.charCodeAt(0));
  } catch {
    return null;
  }
}

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

/** Length-independent comparison — never `===` on a MAC. */
function timingSafeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i += 1) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

export async function signUnsubscribeToken(
  secret: string,
  payload: UnsubscribeTokenPayload,
): Promise<string> {
  const encoded = base64urlEncode(
    encoder.encode(JSON.stringify({ o: payload.organizationId, e: payload.email })),
  );
  const mac = await hmacHex(secret, `${PURPOSE}${encoded}`);
  return `${encoded}.${mac}`;
}

/**
 * Returns the payload only for a token this server signed. Never throws:
 * every malformed shape, bad base64, non-JSON body, wrong field type and
 * failed MAC returns `null`, so the caller has exactly one rejection path
 * and cannot accidentally distinguish "forged" from "corrupt" in a
 * response.
 */
export async function verifyUnsubscribeToken(
  secret: string,
  token: string,
): Promise<UnsubscribeTokenPayload | null> {
  const separator = token.indexOf('.');
  if (separator <= 0) return null;
  const encoded = token.slice(0, separator);
  const mac = token.slice(separator + 1);
  if (!/^[0-9a-f]{64}$/.test(mac)) return null;

  const expected = await hmacHex(secret, `${PURPOSE}${encoded}`);
  if (!timingSafeEqual(expected, mac)) return null;

  const bytes = base64urlDecode(encoded);
  if (bytes === null) return null;
  let parsed: unknown;
  try {
    parsed = JSON.parse(new TextDecoder().decode(bytes));
  } catch {
    return null;
  }
  if (typeof parsed !== 'object' || parsed === null) return null;
  const { o, e } = parsed as { o?: unknown; e?: unknown };
  if (typeof o !== 'string' || o.length === 0) return null;
  if (typeof e !== 'string' || e.length === 0) return null;
  return { organizationId: o, email: e };
}

/** The absolute URL that both the header and the in-body link point at. */
export function unsubscribeUrlFor(appBaseUrl: string, token: string): string {
  return `${appBaseUrl}/api/digest/unsubscribe?token=${encodeURIComponent(token)}`;
}
