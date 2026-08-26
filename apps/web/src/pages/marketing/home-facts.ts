/**
 * Parses a Home "product facts" value (`FACTS` in `Home.tsx`, e.g.
 * `'0–100'`, `'5 rules'`) into the pieces `<FactValue>` needs to animate
 * the numeric part with `useCountUp` while keeping everything around it —
 * including the en dash in `'0–100'` — untouched.
 *
 * `prefix + String(target) + suffix` reconstructs the original string
 * exactly (brand-elevation delivery item 7: "the strings must still end
 * up exactly as today"), because the digit run captured as `target` is
 * always the tail-most one and `String(Number(digits))` never changes an
 * unpadded, non-scientific-notation digit run like these.
 */
export interface ParsedFactValue {
  prefix: string;
  target: number;
  suffix: string;
}

const FACT_VALUE_PATTERN = /^(.*?)(\d+)(\D*)$/;

export function parseFactValue(value: string): ParsedFactValue | null {
  const match = FACT_VALUE_PATTERN.exec(value);
  if (match === null) return null;
  const [, prefix = '', digits = '', suffix = ''] = match;
  const target = Number(digits);
  if (!Number.isFinite(target)) return null;
  return { prefix, target, suffix };
}
