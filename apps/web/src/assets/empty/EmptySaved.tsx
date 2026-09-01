import type { ReactElement } from 'react';
import '../../styles/illustrations.css';

/**
 * Empty state: nothing saved yet (empty shelf / bookmark). Decorative,
 * same convention as `EmptyFeed.tsx`.
 *
 * viewBox 160×120. Source ~0.7 KB.
 */
export function EmptySaved({ className }: { className?: string }): ReactElement {
  return (
    <svg
      className={['bm-illust', className].filter(Boolean).join(' ')}
      viewBox="0 0 160 120"
      fill="none"
      role="img"
      aria-hidden="true"
      focusable="false"
    >
      <line
        x1="34"
        y1="86"
        x2="126"
        y2="86"
        stroke="currentColor"
        strokeOpacity="0.35"
        strokeWidth="1.5"
        strokeLinecap="round"
      />

      <path
        d="M66 30 H94 V78 L80 68 L66 78 Z"
        stroke="currentColor"
        strokeOpacity="0.5"
        strokeWidth="1.5"
        strokeLinejoin="round"
      />

      <g className="bm-accent-line" strokeWidth="1.5" strokeDasharray="3 5" strokeLinecap="round">
        <line x1="40" y1="52" x2="56" y2="52" />
        <line x1="104" y1="52" x2="120" y2="52" />
      </g>
    </svg>
  );
}
