/**
 * `/api/admin/*` — INTERNAL_ADMIN surface (Phase 4 stage B). Gated entirely
 * by `requireInternalAdmin` (404 for every non-admin caller — see that
 * middleware's doc comment for why 404 rather than 401/403). Real admin
 * tooling arrives in Phase 10; this is a placeholder endpoint that proves
 * the gate itself is testable end-to-end.
 */
import { Hono } from 'hono';

import type { AppBindings } from '../env';
import { requireInternalAdmin } from '../middleware/admin';

export const adminRoutes = new Hono<AppBindings>();

adminRoutes.use('*', requireInternalAdmin);

adminRoutes.get('/health-details', (c) => c.json({ ok: true, admin: true }));
