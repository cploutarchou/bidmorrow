import { describe, expect, expectTypeOf, it } from 'vitest';

import { PACKAGE } from './index';
import type { Db, RepositoryContext, TenantScoped } from './index';

describe('@bidmorrow/db skeleton', () => {
  it('exports its package name', () => {
    expect(PACKAGE).toBe('@bidmorrow/db');
  });

  it('RepositoryContext carries the schema-typed Drizzle D1 client', () => {
    expectTypeOf<RepositoryContext['db']>().toEqualTypeOf<Db>();
    // @ts-expect-error — an untyped handle no longer satisfies the context
    const _rejected: RepositoryContext = { db: null };
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
