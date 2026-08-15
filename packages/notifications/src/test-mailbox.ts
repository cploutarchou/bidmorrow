/**
 * Phase 12 stage A: test-only in-memory capture of auth transactional email
 * (`AuthEmailProvider`, `auth-mail.ts`) — the ONLY way Playwright E2E can
 * ever obtain a real Better Auth verification/reset URL, since
 * `auth-instance.ts`'s logging fallback deliberately logs `kind`/`to` ONLY
 * (docs/security.md C10: the url/token must never land in structured logs).
 *
 * SECURITY POSTURE (also documented at every call site that wires this in):
 * this module itself does not gate anything — it is inert unless imported
 * and its provider is actually constructed. The double-gate ("only when
 * `APP_ENV` is `local`/`test` AND the `E2E_TEST_HOOKS` env var is exactly
 * `'true'`") lives in `apps/worker/src/auth-instance.ts` (which provider to
 * construct) and `apps/worker/src/routes/test-hooks.ts` (whether the
 * `/api/test/*` routes 404 or serve). A production/staging deploy never sets
 * `E2E_TEST_HOOKS`, so this module is imported but never activated there —
 * verified by `apps/worker/src/test-hooks.d1.test.ts`'s explicit
 * hooks-unset-404 test.
 *
 * RELIABILITY NOTE (module-level in-memory, not D1-backed): `wrangler dev`
 * runs a single workerd isolate for local development (verified: this is
 * the same assumption every other local-dev-only doc in this repo relies
 * on, e.g. the rate-limiter binding), so a module-level array is visible to
 * every request handled by that one process — sufficient for a
 * single-worker Playwright run against `wrangler dev`. This would NOT be
 * reliable across multiple isolates (e.g. concurrent Workers in a
 * multi-process test runner, or a real deployed environment with multiple
 * isolates) — deliberately not attempted here (a `test_mailbox` D1 table
 * would solve that but is over-engineering for a hooks surface that must
 * never exist outside local/test in the first place). If E2E flakiness is
 * ever traced to a missed capture, that is the mechanism to revisit.
 */
import type { AuthEmailKind, AuthEmailProvider } from './auth-mail';

export interface CapturedMail {
  readonly kind: AuthEmailKind;
  readonly to: string;
  readonly url: string;
  readonly sentAt: number;
}

/** Bounded ring buffer — "last N" per the phase instruction, N = 50. */
const MAILBOX_CAPACITY = 50;

let mailbox: CapturedMail[] = [];

/** Test-only `AuthEmailProvider` — captures instead of sending. Never construct outside the double-gated call site above. */
export function createTestMailboxProvider(now: () => number = Date.now): AuthEmailProvider {
  return {
    send({ to, kind, url }) {
      mailbox.push({ kind, to, url, sentAt: now() });
      if (mailbox.length > MAILBOX_CAPACITY) {
        mailbox = mailbox.slice(mailbox.length - MAILBOX_CAPACITY);
      }
      return Promise.resolve();
    },
  };
}

/** Returns captured mail, most-recent-last, optionally filtered by recipient. */
export function getTestMailbox(to?: string): readonly CapturedMail[] {
  return to === undefined ? mailbox : mailbox.filter((mail) => mail.to === to);
}

/** Test-only reset hook (used by test setup, not reachable via any route). */
export function clearTestMailbox(): void {
  mailbox = [];
}
