import { describe, expect, expectTypeOf, it } from 'vitest';

import { PACKAGE } from './index';
import type { RepositoryContext, TenantScoped } from './index';

describe('@bidmorrow/db skeleton', () => {
  it('exports its package name', () => {
    expect(PACKAGE).toBe('@bidmorrow/db');
  });

  it('RepositoryContext carries a db handle that is untyped until Phase 3', () => {
    const ctx: RepositoryContext = { db: null };
    expectTypeOf(ctx.db).toEqualTypeOf<unknown>();
    expect(ctx).toHaveProperty('db');
  });

  it('TenantScoped preserves the argument shape while requiring organizationId', () => {
    interface ListNoticesArgs {
      organizationId: string;
      limit: number;
    }
    expectTypeOf<TenantScoped<ListNoticesArgs>>().toEqualTypeOf<ListNoticesArgs>();

    // @ts-expect-error — args without organizationId violate docs/security.md C6
    type _Rejected = TenantScoped<{ limit: number }>;
  });
});
