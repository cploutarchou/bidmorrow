/**
 * `/api/org/*` — first tenant-scoped endpoints (Phase 4 stage B).
 *
 * Every handler reads `organizationId`/`role` from `c.var` (set by the
 * organization-context middleware from the session — never from client
 * input) and calls repository functions only, per docs/security.md C6.
 */
import { zValidator } from '@hono/zod-validator';
import { Hono } from 'hono';
import { z } from 'zod';
import {
  CapExceededError,
  createDb,
  createOrganization,
  getCompanyProfile,
  getDigestPreferences,
  getMatchingPreferences,
  getOrganizationsForUser,
  listCompanyKeywords,
  replaceCompanyKeywords,
  upsertCompanyProfile,
  insertAuditEvent,
} from '@bidmorrow/db';
import { organizationId as toOrganizationId } from '@bidmorrow/domain';

import type { AppBindings } from '../env';
import { requireOrganization, requireRole } from '../middleware/organization';
import { rateLimitOrgApi } from '../middleware/rate-limit';
import { requireSession } from '../middleware/session';

const createOrganizationSchema = z
  .object({
    name: z.string().trim().min(1).max(200),
  })
  .strict();

const upsertProfileSchema = z
  .object({
    displayName: z.string().trim().min(1).max(200).nullable(),
    description: z.string().trim().max(4000).nullable(),
    website: z.url().nullable(),
    employeeBand: z.string().trim().max(50).nullable(),
    presetKey: z.string().trim().max(100).nullable(),
    onboardingCompletedAt: z.number().int().nonnegative().nullable(),
  })
  .strict();

const keywordInputSchema = z
  .object({
    kind: z.enum(['positive', 'synonym']),
    term: z.string().trim().min(1).max(200),
    synonymGroup: z.string().trim().min(1).max(200).nullable().optional(),
    language: z.string().trim().min(2).max(10).nullable().optional(),
  })
  .strict();

const replaceKeywordsSchema = z
  .object({
    // Sanity bound distinct from the repository's business cap (50) — the
    // 422 CapExceededError path below is what actually enforces the cap.
    keywords: z.array(keywordInputSchema).max(200),
  })
  .strict();

export const orgRoutes = new Hono<AppBindings>();

orgRoutes.use('*', rateLimitOrgApi);
orgRoutes.use('*', requireSession);

orgRoutes.post('/', zValidator('json', createOrganizationSchema), async (c) => {
  const session = c.get('session');
  if (session === undefined) return c.json({ error: 'unauthenticated' }, 401);
  const db = createDb(c.env.DB);

  const existing = await getOrganizationsForUser(db, { userId: session.user.id, limit: 1 });
  if (existing.items.length > 0) {
    return c.json({ error: 'organization_exists' }, 409);
  }

  const { name } = c.req.valid('json');
  const { organization } = await createOrganization(db, { name, createdByUserId: session.user.id });
  await insertAuditEvent(db, {
    actorType: 'user',
    actorId: session.user.id,
    organizationId: toOrganizationId(organization.id),
    action: 'organization.created',
    targetType: 'organization',
    targetId: organization.id,
    occurredAt: Date.now(),
  });
  return c.json({ organization }, 201);
});

// Everything below requires an existing organization, resolved server-side
// from the session's membership only.
orgRoutes.use('/profile', requireOrganization);
orgRoutes.use('/keywords', requireOrganization);

orgRoutes.get('/profile', async (c) => {
  const db = createDb(c.env.DB);
  const organizationId = c.get('organizationId');
  if (organizationId === undefined) return c.json({ error: 'no_organization' }, 403);

  const [profile, matching, digest] = await Promise.all([
    getCompanyProfile(db, organizationId),
    getMatchingPreferences(db, organizationId),
    getDigestPreferences(db, organizationId),
  ]);
  return c.json({ profile, matching, digest });
});

orgRoutes.put(
  '/profile',
  requireRole('ORGANIZATION_OWNER'),
  zValidator('json', upsertProfileSchema),
  async (c) => {
    const db = createDb(c.env.DB);
    const organizationId = c.get('organizationId');
    const session = c.get('session');
    if (organizationId === undefined || session === undefined) {
      return c.json({ error: 'no_organization' }, 403);
    }
    const args = c.req.valid('json');
    const profile = await upsertCompanyProfile(db, organizationId, args);
    await insertAuditEvent(db, {
      actorType: 'user',
      actorId: session.user.id,
      organizationId,
      action: 'profile.updated',
      targetType: 'company_profile',
      targetId: profile.id,
      occurredAt: Date.now(),
    });
    return c.json({ profile });
  },
);

orgRoutes.get('/keywords', async (c) => {
  const db = createDb(c.env.DB);
  const organizationId = c.get('organizationId');
  if (organizationId === undefined) return c.json({ error: 'no_organization' }, 403);
  const page = await listCompanyKeywords(db, organizationId, { limit: 100 });
  return c.json({ keywords: page.items });
});

orgRoutes.put(
  '/keywords',
  requireRole('ORGANIZATION_OWNER'),
  zValidator('json', replaceKeywordsSchema),
  async (c) => {
    const db = createDb(c.env.DB);
    const organizationId = c.get('organizationId');
    const session = c.get('session');
    if (organizationId === undefined || session === undefined) {
      return c.json({ error: 'no_organization' }, 403);
    }
    const { keywords } = c.req.valid('json');
    const normalizedKeywords = keywords.map((keyword) => ({
      kind: keyword.kind,
      term: keyword.term,
      synonymGroup: keyword.synonymGroup ?? null,
      language: keyword.language ?? null,
    }));
    try {
      await replaceCompanyKeywords(db, organizationId, { keywords: normalizedKeywords });
    } catch (cause) {
      if (cause instanceof CapExceededError) {
        return c.json({ error: 'cap_exceeded', cap: cause.cap }, 422);
      }
      throw cause;
    }
    await insertAuditEvent(db, {
      actorType: 'user',
      actorId: session.user.id,
      organizationId,
      action: 'keywords.replaced',
      targetType: 'company_keywords',
      targetId: null,
      occurredAt: Date.now(),
    });
    const page = await listCompanyKeywords(db, organizationId, { limit: 100 });
    return c.json({ keywords: page.items });
  },
);
