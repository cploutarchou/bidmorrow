/**
 * Public-page metadata (M0.2 SEO artifacts).
 *
 * Spec of record: docs/redesign/seo-content-strategy.md §3 (per-page strings,
 * shared OG/Twitter block, share-image spec) and docs/website-redesign-plan.md
 * §10 ("SEO — hygiene only; programmatic SEO stays OUT of scope").
 *
 * Every factual claim below was checked against the surface it describes, not
 * against the spec draft:
 * - founding cap is **100** (apps/web/src/pages/marketing/Pricing.tsx,
 *   Pilot.tsx, Home.tsx, Terms.tsx all say "first 100 customers"; owner
 *   decision 2026-08-26, was 50). The spec
 *   draft's Pilot title said "First 20 Customers" — that number appears
 *   nowhere in the product and would have shipped a false claim.
 * - "life of your subscription" price hold: Pricing.tsx:32, Home.tsx:951.
 * - eight score components summing to 100, five hard-exclusion rules:
 *   docs/matching-engine.md.
 * - support@bidmorrow.com for general contact (pages/marketing/Contact.tsx),
 *   privacy@bidmorrow.com for data requests (pages/marketing/Privacy.tsx) —
 *   the /contact description names both, because routing every question to
 *   support@ would have contradicted the privacy page it links to.
 * - no third-party analytics / no session replay / no data sales:
 *   pages/marketing/Privacy.tsx.
 *
 * Constraints (title ≤ 60, description ≤ 155, canonical absolute) are enforced
 * by seo.test.ts rather than by review alone.
 */

/** Canonical public origin. No trailing slash. */
export const SITE_ORIGIN = 'https://bidmorrow.com';

/**
 * Shared share image — one static asset for every marketing page (per-page OG
 * images are explicitly not V1). Generated reproducibly by
 * scripts/generate-og-image.mjs; never hand-exported.
 */
export const OG_IMAGE_URL = `${SITE_ORIGIN}/og/og-default.png`;
export const OG_IMAGE_WIDTH = '1200';
export const OG_IMAGE_HEIGHT = '630';
export const OG_IMAGE_ALT = 'BidMorrow — Find the tenders worth pursuing. Skip the rest.';

export interface PageMetadata {
  /** ≤ 60 chars. Em dash is the brand separator everywhere. */
  readonly title: string;
  /** ≤ 155 chars. */
  readonly description: string;
  /** Absolute canonical URL. Root keeps its trailing slash; nothing else has one. */
  readonly canonical: string;
}

export const MARKETING_META = {
  home: {
    title: 'BidMorrow — Bid/No-Bid Intelligence for EU Tenders',
    description:
      'BidMorrow scores TED procurement notices 0–100 against your company profile — deterministic, explained point by point. Built for IT consultancies.',
    canonical: `${SITE_ORIGIN}/`,
  },
  howItWorks: {
    title: 'How BidMorrow Works — Scoring, Step by Step',
    description:
      'How BidMorrow works, step by step: profile setup, scoped daily TED ingestion, deterministic 0–100 scoring, and one daily digest email.',
    canonical: `${SITE_ORIGIN}/how-it-works`,
  },
  methodology: {
    title: 'Scoring Methodology, Published in Full — BidMorrow',
    description:
      'Exactly how BidMorrow scores tenders: eight components to 100 points, a documented missing-data policy, and five hard-exclusion rules.',
    canonical: `${SITE_ORIGIN}/methodology`,
  },
  sampleVerdicts: {
    title: 'Sample Verdicts — Real Tenders, Scored — BidMorrow',
    description:
      'Four real TED tenders scored by BidMorrow, each broken down component by component — including one the engine excluded before scoring. No signup.',
    canonical: `${SITE_ORIGIN}/sample-verdicts`,
  },
  cybersecurityTenders: {
    title: 'Cybersecurity Tenders in the EU — BidMorrow',
    description:
      'How to qualify EU cybersecurity tenders: why CPV codes alone miss security work, and two real TED notices scored by BidMorrow, component by component.',
    canonical: `${SITE_ORIGIN}/cybersecurity-tenders`,
  },
  pricing: {
    title: 'Pricing — €29 or €49/Month Flat — BidMorrow',
    description:
      'Two monthly plans, prices on the page: €29 founding (first 100 customers) and €49 standard, VAT included. No annual contracts, no usage fees, no demo gate.',
    canonical: `${SITE_ORIGIN}/pricing`,
  },
  pilot: {
    title: 'Founding Pilot — First 100 Customers — BidMorrow',
    description:
      "Join BidMorrow's founding pilot: €29/month held for the life of your subscription, and a direct line to the team building the product.",
    canonical: `${SITE_ORIGIN}/pilot`,
  },
  contact: {
    title: 'Contact — BidMorrow',
    description:
      'Support, billing and general questions — support@bidmorrow.com. Privacy and data requests — privacy@bidmorrow.com. Email-only by design.',
    canonical: `${SITE_ORIGIN}/contact`,
  },
  privacy: {
    title: 'Privacy — BidMorrow',
    description:
      "What BidMorrow collects and what it deliberately doesn't: no third-party analytics, no session replay, no data sales. Full legal text pending.",
    canonical: `${SITE_ORIGIN}/privacy`,
  },
  terms: {
    title: 'Terms — BidMorrow',
    description:
      'BidMorrow terms summary: decision support only, scoped TED coverage, monthly billing via Paddle (Merchant of Record), cancel any time.',
    canonical: `${SITE_ORIGIN}/terms`,
  },
} as const satisfies Record<string, PageMetadata>;

/** Every marketing URL in the sitemap, in sitemap order. */
export const SITEMAP_PATHS = [
  '/',
  '/how-it-works',
  '/methodology',
  '/sample-verdicts',
  '/cybersecurity-tenders',
  '/pricing',
  '/pilot',
  '/contact',
  '/privacy',
  '/terms',
] as const;
