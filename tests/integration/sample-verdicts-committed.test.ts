/**
 * The public demo's committed data must equal a fresh run of the engine.
 *
 * `apps/web/src/lib/sample-verdicts.generated.ts` is checked in so the
 * /sample-verdicts page needs no build step and no runtime scoring. That
 * convenience is also the risk: change the engine, a component weight, an
 * exclusion rule or a fixture, and the page keeps showing yesterday's numbers
 * while telling visitors they are what the product would say today. Nothing
 * about the page would look wrong.
 *
 * So this test regenerates the verdicts and compares. If it fails, the fix is
 * to re-run the generator and commit the result — never to relax the
 * assertion:
 *
 *   cd packages/procurement && npx tsx scripts/generate-sample-verdicts.ts
 *
 * It lives here rather than in either package because it is precisely a
 * cross-boundary check: `packages/procurement` builds the data and
 * `apps/web` consumes it, and neither is allowed to import the other
 * (CLAUDE.md dependency rules). tests/ is where cross-cutting suites go.
 */
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

import { buildSampleVerdicts } from '../../packages/procurement/src/sample-verdicts';
import {
  SAMPLE_VERDICTS,
  SAMPLE_VERDICT_ENGINE_VERSION,
  SAMPLE_VERDICT_SCORED_AT,
} from '../../apps/web/src/lib/sample-verdicts.generated';

const root = join(dirname(fileURLToPath(import.meta.url)), '..', '..');

const build = buildSampleVerdicts((relativePath) =>
  readFileSync(join(root, 'tests', 'fixtures', 'ted', relativePath), 'utf8'),
);

describe('committed sample verdicts', () => {
  it('match a fresh run of the engine over the same fixtures', () => {
    // Compared as values rather than as file text: Prettier reformats the
    // generated literal (unquoting keys, rewrapping lines), so a textual
    // comparison would fail on formatting alone and teach us to ignore it.
    expect(SAMPLE_VERDICTS).toEqual(build.verdicts);
  });

  it('record the engine version and scoring time the numbers came from', () => {
    expect(SAMPLE_VERDICT_ENGINE_VERSION).toBe(build.engineVersion);
    expect(SAMPLE_VERDICT_SCORED_AT).toBe(build.scoredAt);
  });
});

describe('sample verdict content', () => {
  it('spans the outcome classes the demo exists to show', () => {
    const classes = new Set(SAMPLE_VERDICTS.map((v) => v.classification));
    expect(classes).toContain('EXCLUDED');
    expect(classes.size).toBeGreaterThanOrEqual(3);
  });

  it('shows only notices TED actually published', () => {
    // The Publications Office's own eForms example notices parse and score
    // identically, and several are fixtures in this repo — but they are not
    // tenders anyone could have bid for, and a public page that linked one
    // as though it were would be making a claim that is not true.
    for (const verdict of SAMPLE_VERDICTS) {
      expect(verdict.sourceKind, verdict.id).toBe('ted_notice');
      expect(String(verdict.sourceUrl)).toMatch(/^https:\/\/ted\.europa\.eu\//);
    }
  });

  it('never invents a score for an excluded lot', () => {
    for (const verdict of SAMPLE_VERDICTS) {
      if (verdict.classification !== 'EXCLUDED') continue;
      // The engine stops at the rule and never scores the lot. A zero would
      // be a different claim — "we scored it and it got nothing" — and a
      // breakdown of a score that was never computed is not a breakdown.
      expect(verdict.score).toBeNull();
      expect(verdict.components).toEqual([]);
      expect(verdict.exclusionRule).not.toBeNull();
      expect(verdict.exclusionEvidence).not.toBeNull();
    }
  });

  it('publishes a breakdown that adds up to the score it explains', () => {
    for (const verdict of SAMPLE_VERDICTS) {
      if (verdict.score === null) continue;
      const total = verdict.components.reduce((sum, c) => sum + c.points, 0);
      // The page invites a reader to check the arithmetic; it had better work.
      expect(total, verdict.id).toBeCloseTo(verdict.score, 6);
    }
  });
});
