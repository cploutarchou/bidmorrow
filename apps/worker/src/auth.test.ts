/**
 * Better Auth core smoke tests (Phase 4 stage A, ADR-0002/0007), running
 * inside real workerd + local D1 via @cloudflare/vitest-pool-workers
 * (mirrors index.test.ts's pattern). Exercises the mounted `/api/auth/*`
 * routes end-to-end: sign-up, unverified sign-in rejection, verified
 * sign-in + session cookie, session lookup, sign-out — plus the C10
 * no-token/url-in-logs regression.
 */
import { env, exports } from 'cloudflare:workers';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
// Importing the entry point makes watch mode re-run these tests when it changes.
import './index';

const BASE = 'https://bidmorrow.local';

/** Captures every JSON log line emitted via console.warn/console.error. */
function captureLogs() {
  const lines: string[] = [];
  const warnSpy = vi.spyOn(console, 'warn').mockImplementation((line: unknown) => {
    lines.push(String(line));
  });
  const errorSpy = vi.spyOn(console, 'error').mockImplementation((line: unknown) => {
    lines.push(String(line));
  });
  return {
    lines,
    restore: () => {
      warnSpy.mockRestore();
      errorSpy.mockRestore();
    },
  };
}

let uniqueSeq = 0;
function uniqueEmail(): string {
  uniqueSeq += 1;
  return `auth-smoke-${uniqueSeq}@example.test`;
}

/**
 * Better Auth's database-storage rate limiter (docs/security.md C7) keys on
 * client IP, restricted by P4-R-02 to `cf-connecting-ip` only (packages/auth
 * `advanced.ipAddress.ipAddressHeaders`). Give the password-reset smoke test
 * its own IP so it doesn't share a bucket with the sign-up/sign-in tests
 * above.
 */
function nextTestIp(): string {
  uniqueSeq += 1;
  return `10.${(uniqueSeq >> 8) & 0xff}.${uniqueSeq & 0xff}.2`;
}

/**
 * Better Auth's CSRF protection is origin-header validation against
 * `trustedOrigins` (dependency-versions.md "Better Auth facts") — a
 * cookie-bearing request needs an `Origin` header matching `trustedOrigins`
 * (`BETTER_AUTH_URL` from wrangler.jsonc test vars), same as a real browser
 * fetch would send. This must match the auth base URL, not the arbitrary
 * `BASE` host used for the raw HTTP requests in this test file.
 */
const STATE_CHANGING_HEADERS = { origin: 'http://localhost:8787' };

async function signUp(email: string, password = 'correct horse battery staple 1!') {
  return exports.default.fetch(`${BASE}/api/auth/sign-up/email`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...STATE_CHANGING_HEADERS },
    body: JSON.stringify({ email, password, name: 'Smoke Test' }),
  });
}

async function signIn(email: string, password = 'correct horse battery staple 1!') {
  return exports.default.fetch(`${BASE}/api/auth/sign-in/email`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...STATE_CHANGING_HEADERS },
    body: JSON.stringify({ email, password }),
  });
}

describe('POST /api/auth/sign-up/email', () => {
  let capture: ReturnType<typeof captureLogs>;

  beforeEach(() => {
    capture = captureLogs();
  });

  afterEach(() => {
    capture.restore();
  });

  it('creates a users row with email_verified 0 and fires the verification email stub', async () => {
    const email = uniqueEmail();
    const response = await signUp(email);
    expect(response.status).toBe(200);

    const row = await env.DB.prepare('SELECT email, email_verified FROM users WHERE email = ?')
      .bind(email)
      .first<{ email: string; email_verified: number }>();
    expect(row?.email).toBe(email);
    expect(row?.email_verified).toBe(0);

    // The logging email stub logged the send attempt...
    const emailLog = capture.lines.find(
      (line) => line.includes('"kind":"transactional"') && line.includes(email),
    );
    expect(emailLog).toBeDefined();

    // ...and NEVER logged the verification url/token anywhere (C10).
    for (const line of capture.lines) {
      expect(line).not.toMatch(/verify-email\?token=/);
      expect(line.toLowerCase()).not.toContain('"url"');
    }
  });
});

describe('email verification gate', () => {
  it('rejects sign-in for an unverified user (403 EMAIL_NOT_VERIFIED)', async () => {
    const email = uniqueEmail();
    const signUpResponse = await signUp(email);
    expect(signUpResponse.status).toBe(200);

    const response = await signIn(email);
    expect(response.status).toBe(403);
    const body = (await response.json()) as { code?: string };
    expect(body.code).toBe('EMAIL_NOT_VERIFIED');
    expect(response.headers.get('set-cookie')).toBeNull();
  });

  it('signs in and sets a session cookie once email_verified is set, then session/sign-out work', async () => {
    const email = uniqueEmail();
    const signUpResponse = await signUp(email);
    expect(signUpResponse.status).toBe(200);

    const updated = await env.DB.prepare('UPDATE users SET email_verified = 1 WHERE email = ?')
      .bind(email)
      .run();
    expect(updated.meta.changes).toBe(1);

    const signInResponse = await signIn(email);
    expect(signInResponse.status).toBe(200);
    const setCookie = signInResponse.headers.get('set-cookie');
    expect(setCookie).toBeTruthy();
    expect(setCookie).toMatch(/HttpOnly/i);

    const cookieHeader = setCookie?.split(';')[0] ?? '';

    const sessionResponse = await exports.default.fetch(`${BASE}/api/auth/get-session`, {
      headers: { cookie: cookieHeader },
    });
    expect(sessionResponse.status).toBe(200);
    const session = (await sessionResponse.json()) as { user?: { email?: string } } | null;
    expect(session?.user?.email).toBe(email);

    const signOutResponse = await exports.default.fetch(`${BASE}/api/auth/sign-out`, {
      method: 'POST',
      headers: { cookie: cookieHeader, ...STATE_CHANGING_HEADERS },
    });
    expect(signOutResponse.status).toBe(200);
    const signOutCookie = signOutResponse.headers.get('set-cookie');
    // Sign-out clears the session cookie (Max-Age=0 / empty value).
    expect(signOutCookie).toMatch(/=;|Max-Age=0/i);

    const afterSignOut = await exports.default.fetch(`${BASE}/api/auth/get-session`, {
      headers: { cookie: cookieHeader },
    });
    expect(await afterSignOut.json()).toBeNull();
  });
});

/**
 * P4-R-01 (partial — smoke test only; full token-roundtrip reset stays
 * deferred to Phase 12 E2E). Verifies the request-password-reset flow (path
 * verified from installed better-auth source,
 * `dist/api/routes/password.mjs` `requestPasswordReset` ->
 * `/request-password-reset`) actually triggers our outbound-email hook and,
 * per C10, never puts the token/url anywhere the composition root logs.
 */
describe('POST /api/auth/request-password-reset', () => {
  it('200s for an existing verified user, sends via the logging email provider, and never logs the token/url', async () => {
    const capture = captureLogs();
    try {
      const email = uniqueEmail();
      const ipHeaders = { 'cf-connecting-ip': nextTestIp() };
      const signUpResponse = await exports.default.fetch(`${BASE}/api/auth/sign-up/email`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', ...STATE_CHANGING_HEADERS, ...ipHeaders },
        body: JSON.stringify({
          email,
          password: 'correct horse battery staple 1!',
          name: 'Reset Smoke',
        }),
      });
      expect(signUpResponse.status).toBe(200);
      await env.DB.prepare('UPDATE users SET email_verified = 1 WHERE email = ?').bind(email).run();

      capture.lines.length = 0; // Only inspect logs from the reset request itself.

      const resetResponse = await exports.default.fetch(`${BASE}/api/auth/request-password-reset`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', ...STATE_CHANGING_HEADERS, ...ipHeaders },
        body: JSON.stringify({ email }),
      });
      expect(resetResponse.status).toBe(200);
      const body = (await resetResponse.json()) as { status?: boolean };
      expect(body.status).toBe(true);

      // The logging email provider (packages/notifications
      // `createLoggingEmailProvider`) was invoked for this user: it logs
      // `kind`/`to` only (never `subject`/`text`, which carries the reset
      // url/token per C10). Better Auth's own `AuthEmailKind`
      // ('password_reset' vs 'verification') only ever reaches the
      // `subject` string passed into that provider — by design it is not a
      // field the provider (or its logs) exposes, so this asserts the send
      // attempt happened for the right recipient rather than a kind label
      // that doesn't exist at this layer.
      const emailLog = capture.lines.find(
        (line) => line.includes('"kind":"transactional"') && line.includes(email),
      );
      expect(emailLog).toBeDefined();

      for (const line of capture.lines) {
        expect(line).not.toMatch(/reset-password\/[A-Za-z0-9_-]+/);
        expect(line.toLowerCase()).not.toContain('"url"');
        expect(line.toLowerCase()).not.toContain('"token"');
      }
    } finally {
      capture.restore();
    }
  });
});
