import { describe, expect, it } from 'vitest';

import { scoreBuyer } from './buyer';

/**
 * The code sets under test are the COMPLETE OP-TED eForms-SDK 1.13.2
 * `buyer-legal-type` codelist (docs/dependency-versions.md). The exhaustive
 * cases below exist because the previous sets were partial — 12 of 20 codes —
 * and the gap was invisible: every missing code scored a plausible-looking
 * UNKNOWN 2.5, so nothing failed while universities and hospitals under
 * `body-pl-cga`/`body-pl-ra` quietly lost half their buyer points.
 */

const STRONG_FIT = [
  'cga',
  'la',
  'ra',
  'body-pl',
  'body-pl-cga',
  'body-pl-la',
  'body-pl-ra',
  'eu-ins-bod-ag',
];

const NEUTRAL = [
  'pub-undert',
  'pub-undert-cga',
  'pub-undert-la',
  'pub-undert-ra',
  'org-sub',
  'org-sub-cga',
  'org-sub-la',
  'org-sub-ra',
  'grp-p-aut',
  'int-org',
  'def-cont',
  'spec-rights-entity',
];

describe('scoreBuyer', () => {
  it('null -> UNKNOWN 2.5', () => {
    const result = scoreBuyer(null);
    expect(result.points).toBe(2.5);
    expect(result.status).toBe('UNKNOWN');
  });

  it.each(STRONG_FIT)('strong-fit code %s -> 5', (code) => {
    const result = scoreBuyer(code);
    expect(result.points).toBe(5);
    expect(result.status).toBe('MATCHED');
  });

  it.each(NEUTRAL)('recognized neutral code %s -> 3', (code) => {
    const result = scoreBuyer(code);
    expect(result.points).toBe(3);
    expect(result.status).toBe('PARTIAL');
  });

  it('covers the whole SDK 1.13.2 codelist — 20 codes, none unknown', () => {
    // If the codelist grows in a future SDK, this count assertion is the
    // tripwire that says "re-verify against the new SDK", rather than the
    // new code silently scoring UNKNOWN in production.
    expect(STRONG_FIT.length + NEUTRAL.length).toBe(20);
    for (const code of [...STRONG_FIT, ...NEUTRAL]) {
      expect(scoreBuyer(code).status, code).not.toBe('UNKNOWN');
    }
  });

  it.each([
    'not-a-real-code',
    // Accepted by the previous sets but NOT in the SDK codelist — a notice
    // cannot legally carry them, so they are unknown, not neutral.
    'eu-int-org',
    'not-pub-fond',
  ])('code outside the codelist %s -> UNKNOWN 2.5', (code) => {
    const result = scoreBuyer(code);
    expect(result.points).toBe(2.5);
    expect(result.status).toBe('UNKNOWN');
  });
});
