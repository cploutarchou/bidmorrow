/**
 * robots.txt (robots.ts + the `/robots.txt` route): the pure body per
 * environment, and the served response inside workerd.
 *
 * The staging branch is the point of the whole exercise — the same built
 * assets deploy everywhere, so a static robots.txt would have advertised the
 * production rules and sitemap on staging.bidmorrow.com.
 */
import { exports } from 'cloudflare:workers';
import { describe, expect, it } from 'vitest';
import { robotsTxt } from './robots';
import './index';

describe('robotsTxt (pure)', () => {
  it('production disallows the app surfaces and points at the sitemap', () => {
    const body = robotsTxt('production');
    expect(body).toContain('User-agent: *');
    for (const path of ['/app', '/onboarding', '/api']) {
      expect(body).toContain(`Disallow: ${path}`);
    }
    expect(body).toContain('Sitemap: https://bidmorrow.com/sitemap.xml');
  });

  it('production never advertises /admin — the cloaked surface stays uncloaked', () => {
    // docs/threat-model.md C11: admin isolation is 404 cloaking. robots.txt is
    // the first file a scanner fetches; naming /admin there would hand over
    // the one path the server refuses to confirm exists.
    expect(robotsTxt('production')).not.toContain('/admin');
  });

  it('production leaves the auth routes crawlable so their noindex is readable', () => {
    const body = robotsTxt('production');
    for (const path of ['/login', '/signup', '/verify-email', '/forgot-password']) {
      expect(body).not.toContain(path);
    }
  });

  it('every non-production environment is fully disallowed', () => {
    for (const appEnv of ['staging', 'local', 'test'] as const) {
      expect(robotsTxt(appEnv)).toBe('User-agent: *\nDisallow: /\n');
    }
  });

  it('never advertises the production sitemap outside production', () => {
    for (const appEnv of ['staging', 'local', 'test'] as const) {
      expect(robotsTxt(appEnv)).not.toContain('Sitemap:');
    }
  });
});

describe('GET /robots.txt', () => {
  it('serves text/plain with the body for the running environment', async () => {
    const response = await exports.default.fetch('https://bidmorrow.local/robots.txt');
    expect(response.status).toBe(200);
    expect(response.headers.get('content-type')).toContain('text/plain');
    // The test environment is not production, so the blanket rule applies.
    expect(await response.text()).toBe('User-agent: *\nDisallow: /\n');
  });
});
