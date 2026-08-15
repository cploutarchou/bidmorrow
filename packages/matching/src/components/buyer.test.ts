import { describe, expect, it } from 'vitest';

import { scoreBuyer } from './buyer';

describe('scoreBuyer', () => {
  it('null -> UNKNOWN 2.5', () => {
    const result = scoreBuyer(null);
    expect(result.points).toBe(2.5);
    expect(result.status).toBe('UNKNOWN');
  });

  it.each(['cga', 'la', 'ra', 'body-pl', 'eu-ins-bod-ag'])('strong-fit code %s -> 5', (code) => {
    const result = scoreBuyer(code);
    expect(result.points).toBe(5);
    expect(result.status).toBe('MATCHED');
  });

  it('recognized neutral code -> 3', () => {
    const result = scoreBuyer('pub-undert');
    expect(result.points).toBe(3);
    expect(result.status).toBe('PARTIAL');
  });

  it('unrecognized code -> UNKNOWN 2.5', () => {
    const result = scoreBuyer('not-a-real-code');
    expect(result.points).toBe(2.5);
    expect(result.status).toBe('UNKNOWN');
  });
});
