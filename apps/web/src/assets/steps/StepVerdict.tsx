import type { ReactElement } from 'react';
import '../../styles/illustrations.css';

/**
 * "How it works" step 4 — the verdict card: a badge plus the
 * point-by-point explanation. The badge text ("Strong fit") is a real,
 * stable product label (the verdict taxonomy), not invented copy; the
 * three explanation rows are drawn as generic placeholder bars rather
 * than fabricated sentences, since this is decorative and the real
 * explanation text lives on the actual verdict card in the product.
 * Decorative, same convention as `StepSource.tsx`.
 *
 * viewBox 320×200. Source ~1.3 KB.
 */
export function StepVerdict({ className }: { className?: string }): ReactElement {
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

      <rect
        x="60"
        y="22"
        width="200"
        height="156"
        rx="12"
        className="bm-surface-fill"
        stroke="currentColor"
        strokeOpacity="0.6"
        strokeWidth="1.5"
      />

      <rect x="78" y="38" width="86" height="24" rx="12" className="bm-accent-fill" />
      <text x="90" y="54.5" className="bm-accent-ink-fill" fontSize="11" fontWeight="600">
        Strong fit
      </text>

      <g stroke="currentColor" strokeWidth="1.5">
        {[86, 112, 138].map((y, i) => (
          <g key={y}>
            <circle cx="84" cy={y} r="6" className="bm-accent-line" fill="none" />
            <path
              d={`M81 ${y} l2 2.5 l4.5 -5`}
              className="bm-accent-stroke"
              strokeWidth="1.4"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
            <line
              x1="98"
              y1={y}
              x2={98 + (128 - i * 22)}
              y2={y}
              strokeOpacity="0.3"
              strokeLinecap="round"
            />
          </g>
        ))}
      </g>
    </svg>
  );
}
