import { useId, type ReactElement } from 'react';

/**
 * BidMorrow brand mark — three stacked rounded bars (approved reference:
 * docs/redesign/mockups/direction-g-strata.html ~L995-1010; the same shape
 * as `apps/web/public/favicon.svg`). The top two bars are filled with
 * `currentColor` at partial opacity so they inherit whatever text color
 * surrounds them in either theme; the bottom bar is filled with the fixed
 * "solar" gradient shared with `.cta`/`.btn-solar` — an intentional brand
 * color, not a theme token (matches favicon.svg's `#solgrad` stops
 * exactly). Sized purely via the `className` prop (CSS, never an inline
 * `style` — CSP `style-src 'self'`).
 *
 * `useId()` gives the `<linearGradient>` a unique id per render so two
 * copies of this mark on the same page (header + footer, on every
 * marketing page) never collide over one `id="solgrad"`.
 */
export function Logo({ className }: { className?: string }): ReactElement {
  const gradientId = `logo-solar-${useId()}`;

  return (
    <svg
      className={className}
      viewBox="0 0 26 26"
      fill="none"
      role="img"
      aria-hidden="true"
      focusable="false"
    >
      <rect x="6.5" y="2.5" width="13" height="6" rx="3" fill="currentColor" opacity="0.28" />
      <rect x="4" y="9.5" width="18" height="6" rx="3" fill="currentColor" opacity="0.55" />
      <rect x="1.5" y="16.5" width="23" height="7" rx="3.5" fill={`url(#${gradientId})`} />
      <defs>
        <linearGradient
          id={gradientId}
          x1="1.5"
          y1="16.5"
          x2="24.5"
          y2="23.5"
          gradientUnits="userSpaceOnUse"
        >
          <stop offset="0" stopColor="#FFB27A" />
          <stop offset="1" stopColor="#FF8896" />
        </linearGradient>
      </defs>
    </svg>
  );
}
