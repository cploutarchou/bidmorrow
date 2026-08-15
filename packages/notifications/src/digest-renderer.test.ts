import { describe, expect, it } from 'vitest';

import { renderDigest } from './digest-renderer';
import type { DigestRenderItem } from './digest-renderer';

const ZERO_COUNTS = { STRONG_MATCH: 0, WORTH_REVIEWING: 0, POSSIBLE_MATCH: 0, LOW_FIT: 0 } as const;

function item(overrides: Partial<DigestRenderItem> = {}): DigestRenderItem {
  return {
    matchId: 'match-1',
    title: 'IT support services',
    score: 82,
    classification: 'STRONG_MATCH',
    reasons: ['CPV match', 'In your geography'],
    topRisk: null,
    buyerName: 'City of Example',
    deadlineAt: Date.parse('2026-09-01T00:00:00Z'),
    ...overrides,
  };
}

describe('renderDigest', () => {
  it('includes counts, title, score/classification, top reasons, buyer, deadline, and CTA link', () => {
    const rendered = renderDigest({
      items: [item()],
      counts: { ...ZERO_COUNTS, STRONG_MATCH: 1 },
      orgName: 'Acme Consulting',
      digestDate: '2026-08-15',
      appBaseUrl: 'https://app.bidmorrow.com',
      manageUrl: 'https://app.bidmorrow.com/app/settings',
    });

    expect(rendered.subject).toContain('1 new match');
    expect(rendered.subject).toContain('2026-08-15');
    expect(rendered.html).toContain('IT support services');
    expect(rendered.html).toContain('82');
    expect(rendered.html).toContain('Strong match');
    expect(rendered.html).toContain('CPV match');
    expect(rendered.html).toContain('In your geography');
    expect(rendered.html).toContain('City of Example');
    expect(rendered.html).toContain('2026-09-01');
    expect(rendered.html).toContain('https://app.bidmorrow.com/app/tenders/match-1');
    expect(rendered.text).toContain('IT support services');
    expect(rendered.text).toContain('https://app.bidmorrow.com/app/tenders/match-1');
  });

  it('renders the POSSIBLE risk-confidence verify wording', () => {
    const rendered = renderDigest({
      items: [
        item({
          topRisk: { explanation: 'ISO 27001 certification mentioned', confidence: 'POSSIBLE' },
        }),
      ],
      counts: { ...ZERO_COUNTS, STRONG_MATCH: 1 },
      orgName: 'Acme',
      digestDate: '2026-08-15',
      appBaseUrl: 'https://app.bidmorrow.com',
      manageUrl: 'https://app.bidmorrow.com/app/settings',
    });
    expect(rendered.html).toContain('verify in source documents');
    expect(rendered.text).toContain('verify in source documents');
  });

  it('renders a HIGH risk confidence as "Confirmed pattern"', () => {
    const rendered = renderDigest({
      items: [
        item({ topRisk: { explanation: 'Security clearance required', confidence: 'HIGH' } }),
      ],
      counts: { ...ZERO_COUNTS, STRONG_MATCH: 1 },
      orgName: 'Acme',
      digestDate: '2026-08-15',
      appBaseUrl: 'https://app.bidmorrow.com',
      manageUrl: 'https://app.bidmorrow.com/app/settings',
    });
    expect(rendered.html).toContain('Confirmed pattern');
  });

  it('escapes a hostile title/buyer name (XSS fixture) — never renders raw source HTML', () => {
    const rendered = renderDigest({
      items: [
        item({
          title: '<script>alert(1)</script> Cleaning services',
          buyerName: '<img src=x onerror=alert(1)>',
          reasons: ['<b>bold reason</b>'],
        }),
      ],
      counts: { ...ZERO_COUNTS, STRONG_MATCH: 1 },
      orgName: 'Acme',
      digestDate: '2026-08-15',
      appBaseUrl: 'https://app.bidmorrow.com',
      manageUrl: 'https://app.bidmorrow.com/app/settings',
    });
    expect(rendered.html).not.toContain('<script>');
    expect(rendered.html).not.toContain('<img src=x');
    expect(rendered.html).not.toContain('<b>bold reason</b>');
    expect(rendered.html).toContain('&lt;script&gt;');
    expect(rendered.html).toContain('&lt;img src=x onerror=alert(1)&gt;');
    expect(rendered.html).toContain('&lt;b&gt;bold reason&lt;/b&gt;');
  });

  it('renders an honest empty state and does not claim matches exist', () => {
    const rendered = renderDigest({
      items: [],
      counts: ZERO_COUNTS,
      orgName: 'Acme',
      digestDate: '2026-08-15',
      appBaseUrl: 'https://app.bidmorrow.com',
      manageUrl: 'https://app.bidmorrow.com/app/settings',
    });
    expect(rendered.subject).toContain('no new matches');
    expect(rendered.html).toContain('No new matches met your digest threshold today.');
    expect(rendered.text).toContain('No new matches met your digest threshold today.');
  });

  it('caps rendered items at 10 even when more are passed in, sorted-order assumed from the caller', () => {
    const items = Array.from({ length: 15 }, (_, i) =>
      item({ matchId: `match-${i}`, title: `Lot ${i}` }),
    );
    const rendered = renderDigest({
      items,
      counts: { ...ZERO_COUNTS, STRONG_MATCH: 15 },
      orgName: 'Acme',
      digestDate: '2026-08-15',
      appBaseUrl: 'https://app.bidmorrow.com',
      manageUrl: 'https://app.bidmorrow.com/app/settings',
    });
    expect(rendered.html).toContain('Lot 9');
    expect(rendered.html).not.toContain('Lot 10');
    expect(rendered.text).toContain('Lot 9');
    expect(rendered.text).not.toContain('Lot 10');
  });

  it('includes classification counts, TED attribution, decision-support wording, manage-preferences link, and opt-out note', () => {
    const rendered = renderDigest({
      items: [item()],
      counts: { STRONG_MATCH: 1, WORTH_REVIEWING: 2, POSSIBLE_MATCH: 3, LOW_FIT: 0 },
      orgName: 'Acme',
      digestDate: '2026-08-15',
      appBaseUrl: 'https://app.bidmorrow.com',
      manageUrl: 'https://app.bidmorrow.com/app/settings',
    });
    expect(rendered.html).toContain('Strong: 1');
    expect(rendered.html).toContain('Worth reviewing: 2');
    expect(rendered.html).toContain('Possible: 3');
    expect(rendered.html).toMatch(/Tenders Electronic Daily \(TED\)/);
    expect(rendered.html).toMatch(/decision support, not legal or procurement advice/);
    expect(rendered.html).toContain('https://app.bidmorrow.com/app/settings');
    expect(rendered.html).toMatch(/turn it off any time/);
    expect(rendered.text).toMatch(/Tenders Electronic Daily \(TED\)/);
    expect(rendered.text).toContain('https://app.bidmorrow.com/app/settings');
  });
});
