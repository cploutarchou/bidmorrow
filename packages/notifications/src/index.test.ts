import { describe, expect, it } from 'vitest';

import { EMAIL_KINDS, PACKAGE } from './index';
import type { EmailKind } from './index';

describe('@bidmorrow/notifications skeleton', () => {
  it('exports its package name', () => {
    expect(PACKAGE).toBe('@bidmorrow/notifications');
  });

  it('owns the outbound email kind split', () => {
    expect(EMAIL_KINDS).toEqual(['transactional', 'digest']);
    expect(new Set(EMAIL_KINDS).size).toBe(EMAIL_KINDS.length);

    const kind: EmailKind = 'digest';
    expect(EMAIL_KINDS).toContain(kind);
  });
});
