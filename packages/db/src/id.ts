/**
 * ULID generation for TEXT primary keys (docs/data-model.md Conventions).
 *
 * 26-char Crockford-base32 ULID: 10 chars encode the 48-bit epoch-millis
 * timestamp, 16 chars encode 80 bits from `crypto.getRandomValues`. IDs are
 * therefore time-sortable at millisecond granularity, which keeps
 * recent-rows scans on the PK cheap and makes `ORDER BY id` a deterministic
 * creation-order sort.
 *
 * Deliberately NOT monotonic within a millisecond: two IDs generated in the
 * same ms sort in random relative order. No consumer requires sub-ms
 * ordering, and monotonic ULIDs need cross-call mutable state that buys
 * nothing here.
 */

/** Crockford base32 alphabet (no I, L, O, U). */
const CROCKFORD = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';

const TIME_CHARS = 10;
const RANDOM_BYTES = 16;
const MAX_TIMESTAMP = 2 ** 48 - 1;

/**
 * Generates a new ULID. `timestampMs` defaults to now; passing it explicitly
 * exists for tests only — rows persist their own `created_at`, the ID
 * timestamp is never read back.
 */
export function newId(timestampMs: number = Date.now()): string {
  if (!Number.isInteger(timestampMs) || timestampMs < 0 || timestampMs > MAX_TIMESTAMP) {
    throw new Error(`newId: timestamp must be an integer in [0, 2^48), got ${timestampMs}`);
  }

  let t = timestampMs;
  let time = '';
  for (let i = 0; i < TIME_CHARS; i++) {
    time = CROCKFORD.charAt(t % 32) + time;
    t = Math.floor(t / 32);
  }

  // 256 is divisible by 32, so `byte % 32` is uniform over the alphabet.
  const bytes = new Uint8Array(RANDOM_BYTES);
  crypto.getRandomValues(bytes);
  let random = '';
  for (const byte of bytes) {
    random += CROCKFORD.charAt(byte % 32);
  }

  return time + random;
}
