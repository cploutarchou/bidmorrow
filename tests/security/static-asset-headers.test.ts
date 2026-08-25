/**
 * SEC-P7-01: sanity-checks the SPA static-assets `_headers` file (Vite
 * copies `apps/web/public/` into `apps/web/dist/` verbatim, so
 * `apps/web/public/_headers` IS what ships to Cloudflare Workers Static
 * Assets). Two things are asserted:
 *
 * 1. The source file (always present in the repo) carries every required
 *    directive.
 * 2. If a `dist/_headers` build artifact exists (i.e. `pnpm build` already
 *    ran in this workspace), it is byte-identical to the source — proving
 *    Vite's public-dir copy actually happened and nothing rewrote it.
 *    (This test does not itself invoke `pnpm build`; the quality-gate build
 *    step, run every session per `.claude/skills/run-quality-gates`, covers
 *    the "confirm it's really in dist" half end-to-end.)
 */
import { existsSync, readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const HERE = dirname(fileURLToPath(import.meta.url));
const SOURCE_HEADERS_PATH = resolve(HERE, '../../apps/web/public/_headers');
const DIST_HEADERS_PATH = resolve(HERE, '../../apps/web/dist/_headers');

describe('_headers (SEC-P7-01)', () => {
  const source = readFileSync(SOURCE_HEADERS_PATH, 'utf-8');

  it('applies to every path', () => {
    expect(source).toMatch(/^\/\*$/m);
  });

  it('sets the strict CSP (Paddle origins only, no inline/eval scripts)', () => {
    expect(source).toContain(
      "Content-Security-Policy: default-src 'self'; script-src 'self' https://cdn.paddle.com; style-src 'self' https://cdn.paddle.com https://sandbox-cdn.paddle.com 'unsafe-inline'; img-src 'self' data: https://*.paddle.com; connect-src 'self' https://*.paddle.com; frame-src https://buy.paddle.com https://sandbox-buy.paddle.com; frame-ancestors 'none'; object-src 'none'; base-uri 'self'; form-action 'self'",
    );
    // Styles may be inline (Paddle.js overlay); scripts never.
    const scriptSrc = source.split(';').find((d) => d.trim().startsWith('script-src')) ?? '';
    expect(scriptSrc).not.toContain('unsafe-inline');
    expect(source).not.toContain('unsafe-eval');
  });

  it('sets HSTS, X-Content-Type-Options, Referrer-Policy, Permissions-Policy, X-Frame-Options', () => {
    expect(source).toMatch(/Strict-Transport-Security: max-age=\d+/);
    expect(source).toContain('X-Content-Type-Options: nosniff');
    expect(source).toContain('Referrer-Policy: strict-origin-when-cross-origin');
    expect(source).toContain('Permissions-Policy:');
    expect(source).toContain('X-Frame-Options: DENY');
  });

  it('is copied verbatim into dist/ by a completed build, when one exists', () => {
    if (!existsSync(DIST_HEADERS_PATH)) {
      // No build artifact in this run (e.g. a test-only invocation before
      // `pnpm build`) — the quality-gate build step covers this separately.
      return;
    }
    const dist = readFileSync(DIST_HEADERS_PATH, 'utf-8');
    expect(dist).toBe(source);
  });
});
