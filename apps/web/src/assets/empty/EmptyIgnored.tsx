import type { ReactElement } from 'react';
import '../../styles/illustrations.css';

/**
 * Empty state: nothing ignored yet (crossed-out card, muted). Decorative,
 * same convention as `EmptyFeed.tsx`.
 *
 * viewBox 160×120. Source ~0.7 KB.
 */
export function EmptyIgnored({ className }: { className?: string }): ReactElement {
  return (
    <svg
      className={['bm-illust', className].filter(Boolean).join(' ')}
      viewBox="0 0 160 120"
      fill="none"
      role="img"
      aria-hidden="true"
      focusable="false"
    >
      <g stroke="currentColor" strokeWidth="1.5">
        <rect x="46" y="34" width="68" height="52" rx="8" strokeOpacity="0.4" />
        <line x1="58" y1="50" x2="94" y2="50" strokeOpacity="0.3" strokeLinecap="round" />
        <line x1="58" y1="62" x2="82" y2="62" strokeOpacity="0.3" strokeLinecap="round" />
      </g>
      <line
        x1="44"
        y1="32"
        x2="116"
        y2="88"
        className="bm-risk-stroke"
        strokeWidth="1.6"
        strokeLinecap="round"
        opacity="0.7"
      />
    </svg>
  );
}
