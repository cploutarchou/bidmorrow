import type { ReactElement } from 'react';
import '../../styles/illustrations.css';

/**
 * "How it works" step 1 — the official-journal document stream (TED).
 * Decorative: the step already has real page text (title + description)
 * next to it, so this carries `aria-hidden` + empty semantics, matching
 * `Logo.tsx`'s convention (`role="img" aria-hidden="true" focusable="false"`).
 *
 * viewBox 320×200, line-and-soft-fill family: 1.5px strokes, rounded
 * joins, teal accent + neutral ink. Ink via `currentColor`, accent via
 * the `.bm-accent-*` classes in `../../styles/illustrations.css`
 * (`var(--token, <dark fallback>)`). Usage: Home "how it works" panel,
 * intrinsic 320×200, scale with `className`. Source ~1.4 KB.
 */
export function StepSource({ className }: { className?: string }): ReactElement {
  return (
    <svg
      className={['bm-illust', className].filter(Boolean).join(' ')}
      viewBox="0 0 320 200"
      fill="none"
      role="img"
      aria-hidden="true"
      focusable="false"
    >
      <rect
        x="0"
        y="0"
        width="320"
        height="200"
        rx="14"
        className="bm-surface-fill"
        opacity="0.35"
      />

      <g stroke="currentColor" strokeWidth="1.5">
        <rect
          x="52"
          y="34"
          width="142"
          height="104"
          rx="10"
          transform="rotate(-7 123 86)"
          className="bm-surface-fill"
          strokeOpacity="0.25"
        />
        <rect
          x="64"
          y="42"
          width="142"
          height="104"
          rx="10"
          transform="rotate(-2 135 94)"
          className="bm-surface-fill"
          strokeOpacity="0.4"
        />
        <g>
          <rect x="78" y="50" width="142" height="104" rx="10" className="bm-surface-fill" />
          <rect x="78" y="50" width="142" height="104" rx="10" strokeOpacity="0.6" />
          <rect
            x="78"
            y="50"
            width="142"
            height="24"
            rx="10"
            className="bm-accent-tint"
            stroke="none"
          />
          <text x="90" y="66" className="bm-mono bm-accent-text" fontSize="10" fontWeight="600">
            TED · OJ S
          </text>
          <line x1="90" y1="92" x2="188" y2="92" strokeOpacity="0.4" strokeLinecap="round" />
          <line x1="90" y1="106" x2="176" y2="106" strokeOpacity="0.4" strokeLinecap="round" />
          <line x1="90" y1="120" x2="160" y2="120" strokeOpacity="0.4" strokeLinecap="round" />
          <line x1="90" y1="134" x2="182" y2="134" strokeOpacity="0.25" strokeLinecap="round" />
        </g>
      </g>

      <g
        className="bm-accent-stroke"
        strokeWidth="1.5"
        strokeLinecap="round"
        strokeLinejoin="round"
      >
        <path d="M236 90 L262 90" />
        <path d="M254 80 L266 90 L254 100" />
      </g>
    </svg>
  );
}
