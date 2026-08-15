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
  getOrganization,
  getOrgExportBundle,
  getOrganizationsForUser,
  insertProductEvent,
  listCompanyCapabilities,
  listCompanyCertifications,
  listCompanyCpvPreferences,
  listCompanyExclusions,
  listCompanyGeographies,
  listCompanyKeywords,
  replaceCompanyCapabilities,
  replaceCompanyCertifications,
  replaceCompanyCpvPreferences,
  replaceCompanyExclusions,
  replaceCompanyGeographies,
  replaceCompanyKeywords,
  softDeleteOrganization,
  upsertCompanyProfile,
  upsertDigestPreferences,
  upsertMatchingPreferences,
  insertAuditEvent,
} from '@bidmorrow/db';
import {
  CONTRACT_NATURES,
  COMPANY_PRESETS,
  organizationId as toOrganizationId,
} from '@bidmorrow/domain';
import { loadIngestionScope } from '@bidmorrow/procurement';
import { cancelSubscriptionForOrgDeletion } from '@bidmorrow/billing';

import { resolveBillingConfig } from '../billing';
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
    // SEC-P4-03: constrained to http/https so `javascript:`/`data:`/other
    // schemes can never be stored and later rendered as a link. `z.httpUrl`
    // is zod v4's built-in URL-with-protocol-restriction helper (verified
    // from installed zod/v4/classic/schemas — protocol defaults to
    // `core.regexes.httpProtocol`), so no manual regex refine is needed.
    website: z.httpUrl().nullable(),
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

const cpvPreferencesSchema = z
  .object({
    // Sanity bound distinct from the repository's business cap (30) — the
    // 422 CapExceededError path below is what actually enforces the cap.
    cpvCodes: z.array(z.string().trim().min(1).max(20)).max(200),
  })
  .strict();

const geographyInputSchema = z
  .object({
    kind: z.enum(['preferred_nuts', 'opportunity_country', 'country_served']),
    code: z.string().trim().min(1).max(20),
  })
  .strict();

const geographiesSchema = z
  .object({ geographies: z.array(geographyInputSchema).max(200) })
  .strict();

const capabilitiesSchema = z
  .object({ labels: z.array(z.string().trim().min(1).max(200)).max(200) })
  .strict();

const certificationInputSchema = z
  .object({
    certificationCode: z.enum(['ISO_27001', 'ISO_9001', 'SOC2', 'OTHER']),
    label: z.string().trim().min(1).max(200).nullable().optional(),
  })
  .strict();

const certificationsSchema = z
  .object({ certifications: z.array(certificationInputSchema).max(50) })
  .strict();

const exclusionInputSchema = z
  .object({
    kind: z.enum(['cpv_family', 'country', 'nuts', 'phrase', 'contract_nature']),
    value: z.string().trim().min(1).max(200),
  })
  .strict();

const exclusionsSchema = z.object({ exclusions: z.array(exclusionInputSchema).max(200) }).strict();

const matchingPreferencesSchema = z
  .object({
    minValueEur: z.number().nonnegative().nullable(),
    maxValueEur: z.number().nonnegative().nullable(),
    supportedContractNatures: z.array(z.enum(CONTRACT_NATURES)).max(CONTRACT_NATURES.length),
    minimumDaysRemaining: z.number().int().nonnegative().nullable(),
  })
  .strict();

const digestPreferencesSchema = z
  .object({
    enabled: z.boolean(),
    sendEmpty: z.boolean(),
    minClassification: z.enum(['STRONG_MATCH', 'WORTH_REVIEWING', 'POSSIBLE_MATCH', 'LOW_FIT']),
    timezone: z.string().trim().min(1).max(64),
  })
  .strict();

const deleteOrganizationSchema = z
  .object({
    // Exact-match confirmation, verified server-side against the
    // organization's REAL name (never a client-supplied id/name) — never
    // trust the frontend to have gotten it right (docs/security.md C6).
    confirm: z.string().trim().min(1).max(200),
  })
  .strict();

export const orgRoutes = new Hono<AppBindings>();

orgRoutes.use('*', rateLimitOrgApi);
orgRoutes.use('*', requireSession);

orgRoutes.post('/', zValidator('json', createOrganizationSchema), async (c) => {
  const session = c.get('session');
  if (session === undefined) return c.json({ error: 'unauthenticated' }, 401);
  const db = createDb(c.env.DB);

  // SEC-P4-05 (accepted, V1): this existence check and the insert below are
  // not atomic — two concurrent POST /api/org calls from the same user can
  // both pass the check and each create an organization. Accepted for V1
  // because `requireOrganization` deterministically picks the first org (by
  // id order) for a user with multiple memberships, so the failure mode is
  // an orphaned extra org rather than a security issue. A partial unique
  // index on (user_id) via a covering membership-count constraint is
  // scheduled with the next schema migration to close this race.
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

// Public shape (session-authenticated only, no organization needed):
// onboarding presets are static, fully editable pre-fill data — applying one
// is a client-side operation via the PUT endpoints below, never a hidden
// server-side effect.
orgRoutes.get('/presets', (c) => c.json({ presets: COMPANY_PRESETS }));

// Everything below requires an existing organization, resolved server-side
// from the session's membership only.
orgRoutes.use('/profile', requireOrganization);
orgRoutes.use('/keywords', requireOrganization);
orgRoutes.use('/cpv-preferences', requireOrganization);
orgRoutes.use('/geographies', requireOrganization);
orgRoutes.use('/capabilities', requireOrganization);
orgRoutes.use('/certifications', requireOrganization);
orgRoutes.use('/exclusions', requireOrganization);
orgRoutes.use('/matching-preferences', requireOrganization);
orgRoutes.use('/digest-preferences', requireOrganization);
orgRoutes.use('/onboarding/complete', requireOrganization);
orgRoutes.use('/export', requireOrganization);

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
    const existedBefore = (await getCompanyProfile(db, organizationId)) !== null;
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
    if (!existedBefore) {
      await insertProductEvent(db, {
        organizationId,
        userId: session.user.id,
        name: 'onboarding_started',
      });
    }
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

orgRoutes.get('/cpv-preferences', async (c) => {
  const db = createDb(c.env.DB);
  const organizationId = c.get('organizationId');
  if (organizationId === undefined) return c.json({ error: 'no_organization' }, 403);
  const page = await listCompanyCpvPreferences(db, organizationId, { limit: 100 });
  return c.json({ cpvPreferences: page.items });
});

orgRoutes.put(
  '/cpv-preferences',
  requireRole('ORGANIZATION_OWNER'),
  zValidator('json', cpvPreferencesSchema),
  async (c) => {
    const db = createDb(c.env.DB);
    const organizationId = c.get('organizationId');
    const session = c.get('session');
    if (organizationId === undefined || session === undefined) {
      return c.json({ error: 'no_organization' }, 403);
    }
    const { cpvCodes } = c.req.valid('json');
    try {
      await replaceCompanyCpvPreferences(db, organizationId, { cpvCodes });
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
      action: 'cpv_preferences.replaced',
      targetType: 'company_cpv_preferences',
      targetId: null,
      occurredAt: Date.now(),
    });
    const page = await listCompanyCpvPreferences(db, organizationId, { limit: 100 });
    return c.json({ cpvPreferences: page.items });
  },
);

orgRoutes.get('/geographies', async (c) => {
  const db = createDb(c.env.DB);
  const organizationId = c.get('organizationId');
  if (organizationId === undefined) return c.json({ error: 'no_organization' }, 403);
  const page = await listCompanyGeographies(db, organizationId, { limit: 100 });
  return c.json({ geographies: page.items });
});

orgRoutes.put(
  '/geographies',
  requireRole('ORGANIZATION_OWNER'),
  zValidator('json', geographiesSchema),
  async (c) => {
    const db = createDb(c.env.DB);
    const organizationId = c.get('organizationId');
    const session = c.get('session');
    if (organizationId === undefined || session === undefined) {
      return c.json({ error: 'no_organization' }, 403);
    }
    const { geographies } = c.req.valid('json');
    await replaceCompanyGeographies(db, organizationId, { geographies });
    await insertAuditEvent(db, {
      actorType: 'user',
      actorId: session.user.id,
      organizationId,
      action: 'geographies.replaced',
      targetType: 'company_geographies',
      targetId: null,
      occurredAt: Date.now(),
    });
    const page = await listCompanyGeographies(db, organizationId, { limit: 100 });
    return c.json({ geographies: page.items });
  },
);

orgRoutes.get('/capabilities', async (c) => {
  const db = createDb(c.env.DB);
  const organizationId = c.get('organizationId');
  if (organizationId === undefined) return c.json({ error: 'no_organization' }, 403);
  const page = await listCompanyCapabilities(db, organizationId, { limit: 100 });
  return c.json({ capabilities: page.items });
});

orgRoutes.put(
  '/capabilities',
  requireRole('ORGANIZATION_OWNER'),
  zValidator('json', capabilitiesSchema),
  async (c) => {
    const db = createDb(c.env.DB);
    const organizationId = c.get('organizationId');
    const session = c.get('session');
    if (organizationId === undefined || session === undefined) {
      return c.json({ error: 'no_organization' }, 403);
    }
    const { labels } = c.req.valid('json');
    await replaceCompanyCapabilities(db, organizationId, { labels });
    await insertAuditEvent(db, {
      actorType: 'user',
      actorId: session.user.id,
      organizationId,
      action: 'capabilities.replaced',
      targetType: 'company_capabilities',
      targetId: null,
      occurredAt: Date.now(),
    });
    const page = await listCompanyCapabilities(db, organizationId, { limit: 100 });
    return c.json({ capabilities: page.items });
  },
);

orgRoutes.get('/certifications', async (c) => {
  const db = createDb(c.env.DB);
  const organizationId = c.get('organizationId');
  if (organizationId === undefined) return c.json({ error: 'no_organization' }, 403);
  const page = await listCompanyCertifications(db, organizationId, { limit: 100 });
  return c.json({ certifications: page.items });
});

orgRoutes.put(
  '/certifications',
  requireRole('ORGANIZATION_OWNER'),
  zValidator('json', certificationsSchema),
  async (c) => {
    const db = createDb(c.env.DB);
    const organizationId = c.get('organizationId');
    const session = c.get('session');
    if (organizationId === undefined || session === undefined) {
      return c.json({ error: 'no_organization' }, 403);
    }
    const { certifications } = c.req.valid('json');
    const normalized = certifications.map((cert) => ({
      certificationCode: cert.certificationCode,
      label: cert.label ?? null,
    }));
    await replaceCompanyCertifications(db, organizationId, { certifications: normalized });
    await insertAuditEvent(db, {
      actorType: 'user',
      actorId: session.user.id,
      organizationId,
      action: 'certifications.replaced',
      targetType: 'company_certifications',
      targetId: null,
      occurredAt: Date.now(),
    });
    const page = await listCompanyCertifications(db, organizationId, { limit: 100 });
    return c.json({ certifications: page.items });
  },
);

orgRoutes.get('/exclusions', async (c) => {
  const db = createDb(c.env.DB);
  const organizationId = c.get('organizationId');
  if (organizationId === undefined) return c.json({ error: 'no_organization' }, 403);
  const page = await listCompanyExclusions(db, organizationId, { limit: 100 });
  return c.json({ exclusions: page.items });
});

orgRoutes.put(
  '/exclusions',
  requireRole('ORGANIZATION_OWNER'),
  zValidator('json', exclusionsSchema),
  async (c) => {
    const db = createDb(c.env.DB);
    const organizationId = c.get('organizationId');
    const session = c.get('session');
    if (organizationId === undefined || session === undefined) {
      return c.json({ error: 'no_organization' }, 403);
    }
    const { exclusions } = c.req.valid('json');
    await replaceCompanyExclusions(db, organizationId, { exclusions });
    await insertAuditEvent(db, {
      actorType: 'user',
      actorId: session.user.id,
      organizationId,
      action: 'exclusions.replaced',
      targetType: 'company_exclusions',
      targetId: null,
      occurredAt: Date.now(),
    });
    const page = await listCompanyExclusions(db, organizationId, { limit: 100 });
    return c.json({ exclusions: page.items });
  },
);

orgRoutes.get('/matching-preferences', async (c) => {
  const db = createDb(c.env.DB);
  const organizationId = c.get('organizationId');
  if (organizationId === undefined) return c.json({ error: 'no_organization' }, 403);
  const matching = await getMatchingPreferences(db, organizationId);
  return c.json({ matching });
});

orgRoutes.put(
  '/matching-preferences',
  requireRole('ORGANIZATION_OWNER'),
  zValidator('json', matchingPreferencesSchema),
  async (c) => {
    const db = createDb(c.env.DB);
    const organizationId = c.get('organizationId');
    const session = c.get('session');
    if (organizationId === undefined || session === undefined) {
      return c.json({ error: 'no_organization' }, 403);
    }
    const args = c.req.valid('json');
    const matching = await upsertMatchingPreferences(db, organizationId, args);
    await insertAuditEvent(db, {
      actorType: 'user',
      actorId: session.user.id,
      organizationId,
      action: 'matching_preferences.updated',
      targetType: 'matching_preferences',
      targetId: matching.id,
      occurredAt: Date.now(),
    });
    return c.json({ matching });
  },
);

orgRoutes.get('/digest-preferences', async (c) => {
  const db = createDb(c.env.DB);
  const organizationId = c.get('organizationId');
  if (organizationId === undefined) return c.json({ error: 'no_organization' }, 403);
  const digest = await getDigestPreferences(db, organizationId);
  return c.json({ digest });
});

orgRoutes.put(
  '/digest-preferences',
  requireRole('ORGANIZATION_OWNER'),
  zValidator('json', digestPreferencesSchema),
  async (c) => {
    const db = createDb(c.env.DB);
    const organizationId = c.get('organizationId');
    const session = c.get('session');
    if (organizationId === undefined || session === undefined) {
      return c.json({ error: 'no_organization' }, 403);
    }
    const args = c.req.valid('json');
    const digest = await upsertDigestPreferences(db, organizationId, args);
    await insertAuditEvent(db, {
      actorType: 'user',
      actorId: session.user.id,
      organizationId,
      action: 'digest_preferences.updated',
      targetType: 'digest_preferences',
      targetId: digest.id,
      occurredAt: Date.now(),
    });
    return c.json({ digest });
  },
);

/**
 * Marks onboarding complete (`company_profiles.onboarding_completed_at`) and
 * reports whether the org's CPV preferences have zero overlap with the
 * ingestion scope (docs/matching-engine.md "CPV pre-filter" — MATCH-P6-01
 * Phase 7 follow-up): such an org would never see any matches, since the
 * scoring pre-filter requires a shared CPV division.
 */
orgRoutes.post('/onboarding/complete', requireRole('ORGANIZATION_OWNER'), async (c) => {
  const db = createDb(c.env.DB);
  const organizationId = c.get('organizationId');
  const session = c.get('session');
  if (organizationId === undefined || session === undefined) {
    return c.json({ error: 'no_organization' }, 403);
  }
  const existingProfile = await getCompanyProfile(db, organizationId);
  if (existingProfile === null) {
    return c.json({ error: 'profile_required' }, 409);
  }

  const now = Date.now();
  const profile = await upsertCompanyProfile(db, organizationId, {
    displayName: existingProfile.displayName,
    description: existingProfile.description,
    website: existingProfile.website,
    employeeBand: existingProfile.employeeBand,
    presetKey: existingProfile.presetKey,
    onboardingCompletedAt: now,
  });

  const [cpvPrefs, scope] = await Promise.all([
    listCompanyCpvPreferences(db, organizationId, { limit: 100 }),
    loadIngestionScope(db),
  ]);
  const scopeDivisions = new Set(
    scope.cpvFamilies.map((entry) => (entry.length >= 8 ? entry.slice(0, 2) : entry)),
  );
  const orgDivisions = new Set(cpvPrefs.items.map((c) => c.cpvCode.slice(0, 2)));
  const overlaps = [...orgDivisions].some((division) => scopeDivisions.has(division));
  const scopeOverlapWarning = !overlaps;

  await insertAuditEvent(db, {
    actorType: 'user',
    actorId: session.user.id,
    organizationId,
    action: 'onboarding.completed',
    targetType: 'company_profile',
    targetId: profile.id,
    occurredAt: now,
  });
  await insertProductEvent(db, {
    organizationId,
    userId: session.user.id,
    name: 'onboarding_completed',
    propertiesJson: JSON.stringify({ scopeOverlapWarning }),
  });

  return c.json({ profile, scopeOverlapWarning });
});

/**
 * `DELETE /api/org` — self-service organization deletion (Phase 11 stage A,
 * docs/privacy.md commitment 2).
 *
 * OWNER only. Requires the caller to type the organization's EXACT current
 * name in `{ confirm }`, verified server-side against the real row (never a
 * client-supplied id) — a mismatch is a 400, never a partial/fuzzy match.
 *
 * Effect: soft-deletes (`organizations.status = 'deleted'`) immediately —
 * every member (including the caller) loses `/api/org/*` access on their
 * very next request (`middleware/organization.ts`'s `organization_deleted`
 * 403), and the org drops out of scoring/digest eligibility on the same
 * request (`listOrgsEligibleForScoring`/`listOrgsWithDigestEnabled`, both
 * filter `status = 'active'`). Data is NOT hard-deleted here — the daily
 * retention cron's `runOrgPurge` hard-deletes owned rows after a 30-day
 * grace period (docs/privacy.md commitment 3), giving support a window to
 * reverse an accidental deletion before it becomes unrecoverable.
 *
 * Stripe: best-effort `cancel_at_period_end` cancellation. Never blocks the
 * deletion itself — Stripe being unreachable/misconfigured must not prevent
 * a privacy-motivated deletion. Every outcome (canceled / no subscription /
 * already canceled / not configured / API error) is written into the audit
 * row's `afterSummary` so an unconfigured or failed cancellation is always
 * visible for manual follow-up (docs/privacy.md), never silently lost.
 */
orgRoutes.delete(
  '/',
  requireOrganization,
  requireRole('ORGANIZATION_OWNER'),
  zValidator('json', deleteOrganizationSchema),
  async (c) => {
    const db = createDb(c.env.DB);
    const organizationId = c.get('organizationId');
    const session = c.get('session');
    if (organizationId === undefined || session === undefined) {
      return c.json({ error: 'no_organization' }, 403);
    }

    const organization = await getOrganization(db, organizationId);
    if (organization === null) {
      return c.json({ error: 'no_organization' }, 404);
    }
    const { confirm } = c.req.valid('json');
    if (confirm !== organization.name) {
      return c.json({ error: 'confirm_mismatch' }, 400);
    }

    const deleted = await softDeleteOrganization(db, organizationId);
    if (!deleted) {
      return c.json({ error: 'organization_already_deleted' }, 409);
    }

    let billingSummary: string;
    const billingConfig = resolveBillingConfig(c.env);
    if (billingConfig === null) {
      billingSummary = 'stripe_not_configured; manual cancellation required';
      c.get('logger').warn('org.delete.stripe_not_configured', { organization_id: organizationId });
    } else {
      try {
        const outcome = await cancelSubscriptionForOrgDeletion(
          { db, stripe: billingConfig.stripe },
          { organizationId },
        );
        billingSummary = `stripe:${outcome.kind}`;
      } catch (cause) {
        billingSummary = 'stripe_cancellation_failed; manual cancellation required';
        c.get('logger').error('org.delete.stripe_cancellation_failed', {
          organization_id: organizationId,
          error: cause instanceof Error ? cause.message : String(cause),
        });
      }
    }

    await insertAuditEvent(db, {
      actorType: 'user',
      actorId: session.user.id,
      organizationId,
      action: 'organization.deleted',
      targetType: 'organization',
      targetId: organizationId,
      beforeSummary: `name=${organization.name}`,
      afterSummary: billingSummary,
      occurredAt: Date.now(),
    });

    return c.json({ status: 'deleted', billing: billingSummary });
  },
);

/**
 * `GET /api/org/export` — self-service data export (Phase 11 stage A,
 * docs/privacy.md commitment 4). OWNER only. Returns the org's own data as
 * a single bounded JSON bundle (profile, preferences, saved/ignored/
 * feedback with tender titles) — see `getOrgExportBundle`'s doc for the
 * exact shape and per-collection cap. Deliberately excludes the global
 * tender corpus (public TED content, not part of a portability request).
 * Rate-limited by the same `API_RATE_LIMITER` binding as every other
 * `/api/org/*` route (`orgRoutes.use('*', rateLimitOrgApi)` above).
 */
orgRoutes.get('/export', requireRole('ORGANIZATION_OWNER'), async (c) => {
  const db = createDb(c.env.DB);
  const organizationId = c.get('organizationId');
  const session = c.get('session');
  if (organizationId === undefined || session === undefined) {
    return c.json({ error: 'no_organization' }, 403);
  }
  const bundle = await getOrgExportBundle(db, organizationId);
  await insertAuditEvent(db, {
    actorType: 'user',
    actorId: session.user.id,
    organizationId,
    action: 'organization.data_exported',
    targetType: 'organization',
    targetId: organizationId,
    afterSummary: bundle.truncated ? 'truncated=true' : 'truncated=false',
    occurredAt: Date.now(),
  });
  return c.json(bundle);
});
