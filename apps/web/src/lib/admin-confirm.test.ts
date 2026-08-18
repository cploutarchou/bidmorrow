import { describe, expect, it } from 'vitest';
import { confirmationMatches } from './admin-confirm';

describe('confirmationMatches', () => {
  it('requires an exact match', () => {
    expect(confirmationMatches('SUSPEND_ORGANIZATION', 'SUSPEND_ORGANIZATION')).toBe(true);
  });

  it('rejects a case mismatch', () => {
    expect(confirmationMatches('SUSPEND_ORGANIZATION', 'suspend_organization')).toBe(false);
  });

  it('rejects a partial/prefix match', () => {
    expect(confirmationMatches('SUSPEND_ORGANIZATION', 'SUSPEND_ORGANIZATIO')).toBe(false);
  });

  it('rejects leading/trailing whitespace (no implicit trim)', () => {
    expect(confirmationMatches('SUSPEND_ORGANIZATION', ' SUSPEND_ORGANIZATION ')).toBe(false);
  });

  it('rejects the empty string', () => {
    expect(confirmationMatches('SUSPEND_ORGANIZATION', '')).toBe(false);
  });
});
