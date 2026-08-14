import { describe, expect, it } from 'vitest';

import { lotId, matchId, noticeId, organizationId } from './ids';
import type { NoticeId, OrganizationId } from './ids';

describe('branded id makers', () => {
  it('return the input string branded, unchanged at runtime', () => {
    expect(organizationId('01J0ORG')).toBe('01J0ORG');
    expect(noticeId('01J0NOTICE')).toBe('01J0NOTICE');
    expect(lotId('01J0LOT')).toBe('01J0LOT');
    expect(matchId('01J0MATCH')).toBe('01J0MATCH');
  });

  it('reject empty and whitespace-only values', () => {
    expect(() => organizationId('')).toThrow(/OrganizationId/);
    expect(() => noticeId('   ')).toThrow(/NoticeId/);
    expect(() => lotId('')).toThrow(/LotId/);
    expect(() => matchId('\t')).toThrow(/MatchId/);
  });

  it('keep entity brands incompatible at the type level', () => {
    const org: OrganizationId = organizationId('01J0ORG');

    // @ts-expect-error an OrganizationId is not a NoticeId
    const wrong: NoticeId = org;
    expect(wrong).toBe('01J0ORG');

    // @ts-expect-error a plain string is not an OrganizationId without the maker
    const plain: OrganizationId = '01J0ORG';
    expect(plain).toBe('01J0ORG');
  });
});
