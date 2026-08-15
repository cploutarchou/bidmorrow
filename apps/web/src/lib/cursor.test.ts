import { describe, expect, it } from 'vitest';
import { appendCursor, startCursor } from './cursor';

describe('startCursor', () => {
  it('initializes state from the first page', () => {
    const state = startCursor({ items: [1, 2, 3], nextCursor: 'abc' });
    expect(state.items).toEqual([1, 2, 3]);
    expect(state.nextCursor).toBe('abc');
  });
});

describe('appendCursor', () => {
  it('appends items and adopts the new cursor', () => {
    const first = startCursor({ items: [1, 2], nextCursor: 'a' });
    const merged = appendCursor(first, { items: [3, 4], nextCursor: 'b' });
    expect(merged.items).toEqual([1, 2, 3, 4]);
    expect(merged.nextCursor).toBe('b');
  });

  it('supports terminal pages (null cursor stops load-more)', () => {
    const first = startCursor({ items: [1], nextCursor: 'a' });
    const merged = appendCursor(first, { items: [2], nextCursor: null });
    expect(merged.nextCursor).toBeNull();
  });
});
