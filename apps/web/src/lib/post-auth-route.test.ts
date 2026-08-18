import { afterEach, describe, expect, it, vi } from 'vitest';
import { isSafeReturnTo, resolvePostAuthDestination } from './post-auth-route';
import type { OrgProfileResponse } from './onboarding-types';

function mockProfileFetch(response: {
  status: number;
  body: OrgProfileResponse | Record<string, never>;
}): void {
  vi.stubGlobal(
    'fetch',
    vi.fn(async () => {
      return new Response(JSON.stringify(response.body), {
        status: response.status,
        headers: { 'content-type': 'application/json' },
      });
    }),
  );
}

describe('isSafeReturnTo', () => {
  it('accepts a single-leading-slash internal path', () => {
    expect(isSafeReturnTo('/app/tenders/abc')).toBe(true);
    expect(isSafeReturnTo('/app')).toBe(true);
  });

  it('rejects null/undefined/empty', () => {
    expect(isSafeReturnTo(null)).toBe(false);
    expect(isSafeReturnTo(undefined)).toBe(false);
    expect(isSafeReturnTo('')).toBe(false);
  });

  it('rejects a full URL (never a scheme)', () => {
    expect(isSafeReturnTo('https://evil.example/phish')).toBe(false);
    expect(isSafeReturnTo('http://evil.example')).toBe(false);
  });

  it('rejects protocol-relative and backslash-variant open-redirect payloads', () => {
    expect(isSafeReturnTo('//evil.example')).toBe(false);
    expect(isSafeReturnTo('/\\evil.example')).toBe(false);
  });

  it('rejects a path not starting with a slash', () => {
    expect(isSafeReturnTo('app/tenders/abc')).toBe(false);
  });
});

describe('resolvePostAuthDestination', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('honors a safe returnTo without ever probing the profile', async () => {
    const fetchSpy = vi.fn();
    vi.stubGlobal('fetch', fetchSpy);
    await expect(resolvePostAuthDestination('/app/tenders/abc')).resolves.toBe('/app/tenders/abc');
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('ignores an unsafe returnTo and falls back to the profile probe', async () => {
    mockProfileFetch({ status: 200, body: { profile: null, matching: null, digest: null } });
    await expect(resolvePostAuthDestination('https://evil.example')).resolves.toBe('/onboarding');
  });

  it('routes to /onboarding when there is no profile yet', async () => {
    mockProfileFetch({ status: 200, body: { profile: null, matching: null, digest: null } });
    await expect(resolvePostAuthDestination(null)).resolves.toBe('/onboarding');
  });

  it('routes to /onboarding when the profile has never been marked complete', async () => {
    mockProfileFetch({
      status: 200,
      body: {
        profile: {
          id: 'p1',
          organizationId: 'o1',
          displayName: 'Acme',
          description: null,
          website: null,
          employeeBand: null,
          presetKey: null,
          onboardingCompletedAt: null,
        },
        matching: null,
        digest: null,
      },
    });
    await expect(resolvePostAuthDestination(undefined)).resolves.toBe('/onboarding');
  });

  it('routes to /app when the profile is complete', async () => {
    mockProfileFetch({
      status: 200,
      body: {
        profile: {
          id: 'p1',
          organizationId: 'o1',
          displayName: 'Acme',
          description: null,
          website: null,
          employeeBand: null,
          presetKey: null,
          onboardingCompletedAt: 1_700_000_000_000,
        },
        matching: null,
        digest: null,
      },
    });
    await expect(resolvePostAuthDestination(null)).resolves.toBe('/app');
  });

  it('routes to /onboarding on a 403 (no organization yet)', async () => {
    mockProfileFetch({ status: 403, body: {} });
    await expect(resolvePostAuthDestination(null)).resolves.toBe('/onboarding');
  });

  it('fails open to /app on any other error (network blip, 5xx)', async () => {
    mockProfileFetch({ status: 500, body: {} });
    await expect(resolvePostAuthDestination(null)).resolves.toBe('/app');
  });
});
