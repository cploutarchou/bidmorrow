/**
 * Guards a public promise with an executable check.
 *
 * `/privacy`'s meta description (apps/web/src/lib/seo.ts) and the privacy page
 * itself state "no third-party analytics, no session replay". That is true
 * today only because the SPA contains no analytics loader at all — GA4 is an
 * OPEN owner decision (HUMAN_DECISION_BLOCKERS item 10: a real measurement ID
 * plus a CSP allowlist change for googletagmanager.com / google-analytics.com).
 *
 * Nothing else connects that future decision to this shipped claim, so turning
 * analytics on would quietly convert a published privacy promise into a false
 * one. This test is that connection: adding a third-party analytics loader
 * fails here, forcing the privacy copy — and the CSP — to be revisited in the
 * same change rather than months later.
 *
 * Lives in tests/security (a Node-environment project) rather than beside
 * seo.ts, because it walks the filesystem.
 */
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { MARKETING_META } from '../../apps/web/src/lib/seo';

const WEB_SRC = resolve(dirname(fileURLToPath(import.meta.url)), '../../apps/web/src');

/** Markers for the third-party analytics the privacy copy promises we don't run. */
const ANALYTICS_MARKERS = ['googletagmanager.com', 'google-analytics.com', 'gtag('];

function sourceFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((entry) => {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) return sourceFiles(full);
    return /\.(ts|tsx)$/.test(entry) && !entry.endsWith('.test.ts') ? [full] : [];
  });
}

describe('privacy claim: no third-party analytics', () => {
  it('the claim is actually published', () => {
    expect(MARKETING_META.privacy.description).toContain('no third-party analytics');
  });

  it('no third-party analytics loader exists in the shipped SPA', () => {
    const files = sourceFiles(WEB_SRC);
    // Guard against a silently-empty scan: a walk that finds nothing would
    // make the assertion below vacuously true forever.
    expect(files.length).toBeGreaterThan(20);
    const offenders = files.filter((file) =>
      ANALYTICS_MARKERS.some((marker) => readFileSync(file, 'utf8').includes(marker)),
    );
    expect(offenders).toEqual([]);
  });
});
