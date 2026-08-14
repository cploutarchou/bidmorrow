import { describe, expect, it } from 'vitest';

import { ORGANIZATION_ROLES, PACKAGE } from './index';
import type { InternalAdmin, Role } from './index';

describe('@bidmorrow/auth', () => {
  it('exports its package identity', () => {
    expect(PACKAGE).toBe('@bidmorrow/auth');
  });

  it('models exactly the two membership roles', () => {
    expect(ORGANIZATION_ROLES).toEqual(['ORGANIZATION_OWNER', 'MEMBER']);
  });

  it('keeps INTERNAL_ADMIN out of the membership Role union', () => {
    const admin: InternalAdmin = 'INTERNAL_ADMIN';

    // @ts-expect-error INTERNAL_ADMIN is an app-level flag, never a membership role
    const asRole: Role = admin;
    expect(ORGANIZATION_ROLES).not.toContain(asRole);
  });
});
