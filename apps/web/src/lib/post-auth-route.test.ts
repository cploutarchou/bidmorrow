import { describe, expect, it } from 'vitest';
import { isSafeReturnTo } from './post-auth-route';

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
