/**
 * `/api/test/*` — Phase 12 stage A E2E test-only hooks. Double-gated
 * (`isE2ETestHooksEnabled`, `../test-hooks-gate.ts`): every request 404s
 * unless `APP_ENV` is `local`/`test` AND `E2E_TEST_HOOKS === 'true'`. This
 * gate runs as request-level middleware (env bindings are only available
 * per-request in Workers — there is no true module-load-time env to guard
 * on) but is applied FIRST, before any other middleware or handler on this
 * router, so it behaves as the "always 404 unless explicitly enabled"
 * contract the phase instruction describes. NEVER reachable in staging/
 * production (those environments never set `E2E_TEST_HOOKS`).
 *
 * Two hooks:
 * - `GET /mailbox?to=<email>` — reads the in-memory captured auth email
 *   (`@bidmorrow/notifications` `getTestMailbox`), the only way E2E can
 *   obtain a real verification/reset link (the logging fallback
 *   deliberately never logs it — docs/security.md C10).
 * - `POST /score-now` — runs the real scoring engine
 *   (`scoreLotsForOrgs`) synchronously against every currently-ingested lot,
 *   for every scoring-eligible org, so E2E doesn't have to wait for/enqueue
 *   `MATCH_QUEUE` after onboarding. Bounded to `MAX_TEST_SCORE_LOTS` lots —
 *   generous for the two-notice demo seed, defensive against a much larger
 *   local corpus.
 */
import { zValidator } from '@hono/zod-validator';
import { Hono } from 'hono';
import { z } from 'zod';
import { FLAG_ENTITLEMENT_ENFORCED } from '@bidmorrow/config';
import { createDb, setFeatureFlag, tenderLots } from '@bidmorrow/db';
import { getTestMailbox } from '@bidmorrow/notifications';
import { scoreLotsForOrgs } from '@bidmorrow/procurement';

import type { AppBindings } from '../env';
import { isE2ETestHooksEnabled } from '../test-hooks-gate';
import { requireSession } from '../middleware/session';

export const testHookRoutes = new Hono<AppBindings>();

const MAX_TEST_SCORE_LOTS = 500;

testHookRoutes.use('*', async (c, next) => {
  if (!isE2ETestHooksEnabled(c.env)) {
    return c.json({ error: 'not_found', request_id: c.get('requestId') }, 404);
  }
  await next();
});

const mailboxQuerySchema = z.object({ to: z.string().email().optional() });

testHookRoutes.get('/mailbox', zValidator('query', mailboxQuerySchema), (c) => {
  const { to } = c.req.valid('query');
  return c.json({ mails: getTestMailbox(to) });
});

// Session-gated (not just the double-gate above) so an unauthenticated
// request can never trigger a scoring pass even in a test environment.
testHookRoutes.post('/score-now', requireSession, async (c) => {
  const db = createDb(c.env.DB);
  const rows = await db.select({ id: tenderLots.id }).from(tenderLots).limit(MAX_TEST_SCORE_LOTS);
  const result = await scoreLotsForOrgs(
    { db, logger: c.get('logger') },
    { lotIds: rows.map((row) => row.id) },
  );
  return c.json({
    pairsConsidered: result.pairsConsidered,
    pairsScored: result.pairsScored,
    matchesWritten: result.matchesWritten,
    matchesSkipped: result.matchesSkipped,
    truncated: result.truncated,
  });
});

const entitlementEnforcedSchema = z.object({ enabled: z.boolean() }).strict();

// Deliberately narrow (one named flag, boolean only) rather than a generic
// set-any-flag hook — the smallest surface that lets E2E exercise the 402
// paywall state, which is unreachable otherwise (the local stack has no
// Stripe, so no subscription can ever exist to satisfy enforcement).
// Session-gated like score-now; the double-gate above already 404s outside
// local/test with E2E_TEST_HOOKS.
testHookRoutes.post(
  '/entitlement-enforced',
  requireSession,
  zValidator('json', entitlementEnforcedSchema),
  async (c) => {
    const { enabled } = c.req.valid('json');
    const db = createDb(c.env.DB);
    await setFeatureFlag(db, {
      key: FLAG_ENTITLEMENT_ENFORCED,
      valueJson: JSON.stringify(enabled),
      description: 'E2E test hook toggle (local only)',
    });
    return c.json({ enabled });
  },
);
