#!/usr/bin/env node
/**
 * Post-build artifact verification (F-11, PRODUCTION_READINESS_AUDIT.md).
 *
 * WHY THIS EXISTS AS A SEPARATE STEP. `tests/security/static-asset-headers.test.ts`
 * asserts that `apps/web/dist/_headers` is byte-identical to
 * `apps/web/public/_headers` — but only "when one exists", and CI checks out
 * clean and runs Test BEFORE Build, so `dist/` never exists at that point and
 * the assertion silently no-ops on every CI run. A build that stopped copying
 * `_headers` would have shipped the SPA with no CSP, no HSTS and no
 * `X-Frame-Options` on statically-served assets, with every check green.
 *
 * That test's comment used to claim the quality-gate build step covered this
 * half end-to-end. It did not: `pnpm build` only proves the build exits 0,
 * never that the artifact is present or correct. This script is that missing
 * assertion, and it runs AFTER build where it can actually fail.
 *
 * A stale `dist/` fails here too, which is the intended second use: that is
 * exactly how the missing coverage was found — a `dist/` from a pre-Paddle
 * build still carried the old CSP.
 */
import { existsSync, readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const SOURCE = resolve(HERE, '../apps/web/public/_headers');
const DIST = resolve(HERE, '../apps/web/dist/_headers');

const failures = [];

if (!existsSync(DIST)) {
  failures.push(
    `apps/web/dist/_headers is MISSING. Vite copies apps/web/public/ verbatim, so ` +
      `this means the build did not run, or it stopped copying the public dir. ` +
      `Shipping without it removes the CSP, HSTS and X-Frame-Options from every ` +
      `statically-served asset.`,
  );
} else {
  const source = readFileSync(SOURCE, 'utf-8');
  const dist = readFileSync(DIST, 'utf-8');
  if (dist !== source) {
    failures.push(
      `apps/web/dist/_headers differs from apps/web/public/_headers. Either ` +
        `something rewrote it during the build, or dist/ is stale from an earlier ` +
        `build — re-run \`pnpm build\`.\n\n--- public/_headers\n${source}\n--- dist/_headers\n${dist}`,
    );
  }
}

if (failures.length > 0) {
  console.error('Build artifact verification FAILED:\n');
  for (const failure of failures) console.error(`  • ${failure}\n`);
  process.exit(1);
}

console.log('Build artifact verification passed: dist/_headers matches public/_headers.');
