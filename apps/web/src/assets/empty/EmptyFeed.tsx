import type { ReactElement } from 'react';
import '../../styles/illustrations.css';

/**
 * Empty state — feed with nothing scored yet (calm, not an error).
 * Decorative: the surface always carries real empty-state copy next
 * to it, so `aria-hidden` + `focusable="false"`, same convention as
 * `../Logo.tsx` and the step illustrations.
 *
 * viewBox 160×120. Source ~0.8 KB.
 */
export function EmptyFeed({ className }: { className?: string }): ReactElement {
  return (
    <svg
      className={['bm-illust', className].filter(Boolean).join(' ')}
      viewBox="0 0 160 120"
      fill="none"
      role="img"
      aria-hidden="true"
      focusable="false"
    >
      <g stroke="currentColor" strokeWidth="1.5" strokeLinejoin="round">
        <path
          d="M36 46 H60 L68 58 H92 L100 46 H124 V78 A6 6 0 0 1 118 84 H42 A6 6 0 0 1 36 78 Z"
          strokeOpacity="0.5"
        />
        <path d="M60 58 H68" strokeOpacity="0.5" strokeLinecap="round" />
      </g>
      <circle cx="80" cy="30" r="10" className="bm-accent-tint" stroke="none" />
      <path
        d="M75 30 l3.5 3.5 L86 26"
        className="bm-accent-stroke"
        strokeWidth="1.6"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}
