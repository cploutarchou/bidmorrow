import { describe, expect, it } from 'vitest';
import {
  DECISION_SUPPORT_DISCLAIMER,
  HEADLINE,
  PRODUCT_NAME,
  SUBHEADLINE,
  TED_ATTRIBUTION,
} from './copy';

describe('marketing copy', () => {
  it('uses the exact headline from docs/product-scope.md', () => {
    expect(HEADLINE).toBe('Find the tenders worth pursuing. Skip the rest.');
  });

  it('positions the product as bid/no-bid qualification intelligence', () => {
    expect(SUBHEADLINE).toContain(
      'bid/no-bid qualification intelligence for EU public procurement',
    );
    expect(SUBHEADLINE).toContain(
      'Should a company like mine spend time investigating this tender?',
    );
    expect(SUBHEADLINE.startsWith(PRODUCT_NAME)).toBe(true);
  });

  it('carries the required TED source acknowledgement verbatim', () => {
    expect(TED_ATTRIBUTION).toBe(
      'Source of procurement notices: Tenders Electronic Daily (TED), Publications Office of the European Union.',
    );
  });

  it('states the decision-support limits per the product-truth rules', () => {
    expect(DECISION_SUPPORT_DISCLAIMER).toContain('decision support');
    expect(DECISION_SUPPORT_DISCLAIMER).toContain('does not guarantee');
    for (const limit of ['eligibility', 'compliance', 'award']) {
      expect(DECISION_SUPPORT_DISCLAIMER).toContain(limit);
    }
    expect(DECISION_SUPPORT_DISCLAIMER).toContain('original procurement documents');
  });
});
