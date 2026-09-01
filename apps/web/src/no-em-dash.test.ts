/**
 * House typographic rule (owner, production issue #2, 2026-09-01): the em
 * dash (U+2014) appears nowhere on the public or client-area pages.
 *
 * This is a copy rule, not a lint rule, so it is enforced where the copy
 * lives: every `.ts`/`.tsx` under `apps/web/src`, plus `apps/web/index.html`.
 * Scanning source rather than a rendered page is deliberate. Most of this copy
 * is string literals in components no headless render would all reach, and
 * someone restoring an old sentence should fail here rather than in a
 * Playwright run nobody triggers.
 *
 * Conventions used by the sweep, for anyone fixing a failure here rather than
 * reverting one:
 * - Running prose: rewrite the sentence, with a comma, a semicolon, a colon,
 *   a full stop or parentheses, whichever reads best. Never a bare hyphen.
 * - Document titles: `Page name | BidMorrow`; a colon introduces a
 *   descriptive subtitle before the pipe.
 * - Inline label separators (score lines, badges, button labels): ` - `.
 * - Empty-value placeholders in admin tables: an EN dash.
 * En dashes and number ranges (`0-100` written with an en dash, `5-50
 * people`) are outside the rule and stay as they are.
 */
import { describe, expect, it } from 'vitest';

// Escaped, not literal: this file is scanned by the very rule it enforces.
const EM_DASH = '\u2014';

const sources = import.meta.glob('./**/*.{ts,tsx}', {
  query: '?raw',
  import: 'default',
  eager: true,
}) as Record<string, string>;

const shell = import.meta.glob('../index.html', {
  query: '?raw',
  import: 'default',
  eager: true,
}) as Record<string, string>;

/**
 * Files the rule does not yet hold for. Intended to stay EMPTY: an entry is a
 * temporary carve-out with a named reason and a removal condition, never a
 * standing permission to use an em dash. (The one entry the sweep shipped
 * with, `./pages/auth/ResetPassword.tsx`, was removed the same day once the
 * parallel rewrite of that file landed with no em dashes.)
 */
const TEMPORARY_EXCLUSIONS: readonly string[] = [];

const scanned = Object.entries({ ...sources, ...shell })
  .filter(([path]) => !TEMPORARY_EXCLUSIONS.includes(path))
  .sort(([a], [b]) => a.localeCompare(b));

describe('no em dash on public or client-area pages', () => {
  it('scans the whole apps/web surface, so a new page cannot slip past', () => {
    // A guard whose file list quietly emptied would pass for ever.
    const paths = scanned.map(([path]) => path);
    expect(paths.length).toBeGreaterThan(50);
    expect(paths).toContain('../index.html');
    expect(paths).toContain('./copy.ts');
    expect(paths).toContain('./lib/seo.ts');
  });

  it('finds no em dash in any scanned file', () => {
    const offenders: string[] = [];
    for (const [path, text] of scanned) {
      text.split('\n').forEach((line, index) => {
        if (line.includes(EM_DASH)) {
          offenders.push(`${path}:${String(index + 1)}: ${line.trim()}`);
        }
      });
    }
    expect(offenders).toEqual([]);
  });
});
