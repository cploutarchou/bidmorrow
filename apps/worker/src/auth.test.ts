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
