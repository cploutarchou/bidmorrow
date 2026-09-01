import type { ReactElement } from 'react';
import {
  OG_IMAGE_ALT,
  OG_IMAGE_HEIGHT,
  OG_IMAGE_URL,
  OG_IMAGE_WIDTH,
  type PageMetadata,
} from '../lib/seo';

/**
 * Head metadata for a public marketing page: title, description, canonical,
 * and the shared Open Graph / Twitter block
 * (docs/redesign/seo-content-strategy.md §3).
 *
 * There is no head-management library here by design: React 19 hoists bare
 * `<title>`/`<meta>`/`<link>` elements out of the render tree into `<head>`,
 * which is the pattern every page already used before this component existed.
 * Consolidating it here means the 13-tag OG block is written once instead of
 * being retyped (and drifting) on eight pages.
 *
 * Strings come from `MARKETING_META` so their length limits and factual claims
 * are testable in one place (lib/seo.ts, lib/seo.test.ts).
 */
export function PageMeta({ title, description, canonical }: PageMetadata): ReactElement {
  return (
    <>
      <title>{title}</title>
      <meta name="description" content={description} />
      <link rel="canonical" href={canonical} />

      <meta property="og:type" content="website" />
      <meta property="og:site_name" content="BidMorrow" />
      <meta property="og:title" content={title} />
      <meta property="og:description" content={description} />
      <meta property="og:url" content={canonical} />
      <meta property="og:image" content={OG_IMAGE_URL} />
      <meta property="og:image:width" content={OG_IMAGE_WIDTH} />
      <meta property="og:image:height" content={OG_IMAGE_HEIGHT} />
      <meta property="og:image:alt" content={OG_IMAGE_ALT} />

      <meta name="twitter:card" content="summary_large_image" />
      <meta name="twitter:title" content={title} />
      <meta name="twitter:description" content={description} />
      <meta name="twitter:image" content={OG_IMAGE_URL} />
    </>
  );
}
