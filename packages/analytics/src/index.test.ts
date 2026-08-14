import { describe, expect, it } from 'vitest';

import { PACKAGE, PRODUCT_EVENT_NAMES } from './index';
import type { ProductEventName } from './index';

describe('@bidmorrow/analytics', () => {
  it('exports its package identity', () => {
    expect(PACKAGE).toBe('@bidmorrow/analytics');
  });

  it('includes the event names documented in docs/data-model.md', () => {
    expect(PRODUCT_EVENT_NAMES).toContain('feed_viewed');
    expect(PRODUCT_EVENT_NAMES).toContain('digest_opened');
    expect(PRODUCT_EVENT_NAMES).toContain('match_expanded');
  });

  it('keeps names unique and lower_snake', () => {
    expect(new Set(PRODUCT_EVENT_NAMES).size).toBe(PRODUCT_EVENT_NAMES.length);
    for (const name of PRODUCT_EVENT_NAMES) {
      expect(name).toMatch(/^[a-z]+(_[a-z]+)*$/);
    }
  });

  it('derives the union type from the runtime list', () => {
    const event: ProductEventName = 'feed_viewed';
    expect(PRODUCT_EVENT_NAMES).toContain(event);

    // @ts-expect-error unlisted names are not valid ProductEventNames
    const invalid: ProductEventName = 'page_viewed';
    expect(PRODUCT_EVENT_NAMES).not.toContain(invalid);
  });
});
