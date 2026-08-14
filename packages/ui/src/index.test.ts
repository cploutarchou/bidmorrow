import { describe, expect, it } from 'vitest';

import { PACKAGE } from './index';

describe('@bidmorrow/ui', () => {
  it('exports its package identity', () => {
    expect(PACKAGE).toBe('@bidmorrow/ui');
  });
});
