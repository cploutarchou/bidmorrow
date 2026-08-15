/**
 * `GET /api/org/feed` — the customer-facing tender feed (docs/product-
 * scope.md §5). Org resolved from `c.var` only (per docs/security.md C6);
 * every read goes through `listFeedRows` (packages/db/src/repositories/
 * matching.ts), which is the sole place the tab/filter/pagination SQL
 * lives.
 */
import { zValidator } from '@hono/zod-validator';
import { Hono } from 'hono';
import { z } from 'zod';
import { createDb, listFeedRows } from '@bidmorrow/db';
import { ENGINE_VERSION } from '@bidmorrow/matching';

import type { AppBindings } from '../env';
import { requireOrganization } from '../middleware/organization';
import { rateLimitOrgApi } from '../middleware/rate-limit';
import { requireSession } from '../middleware/session';

const feedQuerySchema = z
  .object({
    tab: z.enum(['today', 'strong', 'worth_reviewing', 'possible', 'saved', 'ignored']),
    minScore: z.coerce.number().min(0).max(100).optional(),
    country: z
      .string()
      .trim()
      .length(2)
      .transform((v) => v.toUpperCase())
      .optional(),
    cpvPrefix: z.string().trim().min(2).max(20).optional(),
    buyerName: z.string().trim().min(1).max(200).optional(),
    minValueEur: z.coerce.number().nonnegative().optional(),
    maxValueEur: z.coerce.number().nonnegative().optional(),
    deadlineBefore: z.coerce.number().int().optional(),
    deadlineAfter: z.coerce.number().int().optional(),
    publishedAfter: z
      .string()
      .trim()
      .regex(/^\d{4}-\d{2}-\d{2}$/)
      .optional(),
    limit: z.coerce.number().int().min(1).max(50).optional(),
    cursor: z.string().trim().min(1).max(200).optional(),
  })
  .strict();

export const feedRoutes = new Hono<AppBindings>();

feedRoutes.use('*', rateLimitOrgApi);
feedRoutes.use('*', requireSession);
feedRoutes.use('*', requireOrganization);

feedRoutes.get('/feed', zValidator('query', feedQuerySchema), async (c) => {
  const db = createDb(c.env.DB);
  const organizationId = c.get('organizationId');
  if (organizationId === undefined) return c.json({ error: 'no_organization' }, 403);

  const query = c.req.valid('query');
  // SEC-P7-03: `listFeedRows` throws a plain Error on a malformed/tampered
  // cursor (packages/db `decodeScoreCursor`) — that must surface as a 400
  // to the client, never an unhandled 500.
  let page: Awaited<ReturnType<typeof listFeedRows>>;
  try {
    page = await listFeedRows(db, organizationId, {
      tab: query.tab,
      engineVersion: ENGINE_VERSION,
      now: Date.now(),
      ...(query.minScore !== undefined ? { minScore: query.minScore } : {}),
      ...(query.country !== undefined ? { country: query.country } : {}),
      ...(query.cpvPrefix !== undefined ? { cpvPrefix: query.cpvPrefix } : {}),
      ...(query.buyerName !== undefined ? { buyerName: query.buyerName } : {}),
      ...(query.minValueEur !== undefined ? { minValueEur: query.minValueEur } : {}),
      ...(query.maxValueEur !== undefined ? { maxValueEur: query.maxValueEur } : {}),
      ...(query.deadlineBefore !== undefined ? { deadlineBefore: query.deadlineBefore } : {}),
      ...(query.deadlineAfter !== undefined ? { deadlineAfter: query.deadlineAfter } : {}),
      ...(query.publishedAfter !== undefined ? { publishedAfter: query.publishedAfter } : {}),
      ...(query.limit !== undefined ? { limit: query.limit } : {}),
      ...(query.cursor !== undefined ? { cursor: query.cursor } : {}),
    });
  } catch (cause) {
    if (cause instanceof Error && cause.message.includes('malformed cursor')) {
      return c.json({ error: 'invalid_cursor' }, 400);
    }
    throw cause;
  }

  return c.json({ items: page.items, nextCursor: page.nextCursor });
});
