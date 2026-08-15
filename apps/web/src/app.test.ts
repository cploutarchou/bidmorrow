import { describe, expect, it } from 'vitest';
import {
  CPV_PREFILTER_DISCLOSURE,
  DECISION_SUPPORT_DISCLAIMER,
  HARD_EXCLUSIONS_STATEMENT,
  HEADLINE,
  PRODUCT_NAME,
  RISK_FLAG_STATEMENT,
  SCOPED_COVERAGE_STATEMENT,
  SUBHEADLINE,
  TED_ATTRIBUTION,
  UNKNOWN_POLICY_STATEMENT,
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

describe('methodology disclosures', () => {
  it('states scoped, not exhaustive, coverage per product-truth rules', () => {
    expect(SCOPED_COVERAGE_STATEMENT).toContain('scoped coverage, not exhaustive EU coverage');
    expect(SCOPED_COVERAGE_STATEMENT).toContain('72*');
    expect(SCOPED_COVERAGE_STATEMENT).toContain('48*');
    expect(SCOPED_COVERAGE_STATEMENT).toContain('79417000');
  });

  it('discloses the CPV pre-filter trade-off per docs/matching-engine.md', () => {
    expect(CPV_PREFILTER_DISCLOSURE).toContain('CPV division');
    expect(CPV_PREFILTER_DISCLOSURE).toContain('never scored');
  });

  it('explains the UNKNOWN neutral-score policy in plain language', () => {
    expect(UNKNOWN_POLICY_STATEMENT).toContain('neutral score');
    expect(UNKNOWN_POLICY_STATEMENT).toContain('never');
  });

  it('lists the five hard-exclusion rules and the known-values-only guarantee', () => {
    expect(HARD_EXCLUSIONS_STATEMENT).toContain('excluded geographies');
    expect(HARD_EXCLUSIONS_STATEMENT).toContain('Unknown fields never trigger an exclusion');
  });

  it('carries the verify-in-source-documents wording for risk flags', () => {
    expect(RISK_FLAG_STATEMENT).toContain('verify in source documents');
    expect(RISK_FLAG_STATEMENT).toContain('never an LLM guess');
  });
});
