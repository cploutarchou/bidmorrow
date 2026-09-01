/**
 * Metadata constraints from docs/redesign/seo-content-strategy.md §3, enforced
 * rather than review-checked: titles ≤ 60, descriptions ≤ 155, canonicals
 * absolute on the production origin, a pipe as the brand separator.
 *
 * The founding-cap assertion is the important one: the spec draft said "First
 * 20 Customers" on the pilot page while every product surface says 100. This
 * test fails if that false number is ever reintroduced.
 */
import { describe, expect, it } from 'vitest';
import { MARKETING_META, SITE_ORIGIN, SITEMAP_PATHS, type PageMetadata } from './seo';

const entries = Object.entries(MARKETING_META) as [string, PageMetadata][];

describe('marketing page metadata', () => {
  it('covers exactly the sitemap URL set', () => {
    const canonicals = entries.map(([, meta]) => meta.canonical).sort();
    const expected = SITEMAP_PATHS.map((path) =>
      path === '/' ? `${SITE_ORIGIN}/` : `${SITE_ORIGIN}${path}`,
    ).sort();
    expect(canonicals).toEqual(expected);
  });

  it.each(entries)('%s title is ≤ 60 chars and uses the pipe separator', (_key, meta) => {
    expect(meta.title.length).toBeLessThanOrEqual(60);
    expect(meta.title).toContain(' | ');
    // House rule (owner, 2026-09-01): no em dash in customer-facing copy.
    expect(meta.title).not.toContain('\u2014');
  });

  it.each(entries)('%s description is ≤ 155 chars and non-empty', (_key, meta) => {
    expect(meta.description.length).toBeGreaterThan(0);
    expect(meta.description.length).toBeLessThanOrEqual(155);
    expect(meta.description).not.toContain('\u2014');
  });

  it.each(entries)('%s canonical is absolute on the production origin', (_key, meta) => {
    expect(meta.canonical.startsWith(`${SITE_ORIGIN}/`)).toBe(true);
    // Root keeps its trailing slash; no other canonical has one.
    if (meta.canonical !== `${SITE_ORIGIN}/`) {
      expect(meta.canonical.endsWith('/')).toBe(false);
    }
  });

  it('states the real founding cap (100) and never the spec draft’s 20', () => {
    const pricingAndPilot = `${MARKETING_META.pricing.description} ${MARKETING_META.pilot.title} ${MARKETING_META.pilot.description}`;
    expect(pricingAndPilot).toContain('100');
    expect(pricingAndPilot).not.toMatch(/\b20\b/);
  });
});
