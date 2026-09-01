/**
 * `/api/org/tenders/:matchId` — tender detail, save/ignore actions, and
 * feedback (docs/product-scope.md §5/§6). Org resolved from `c.var` only;
 * `matchId` is always tenant-checked server-side before any lot/notice id
 * derived from it is trusted (docs/security.md C6).
 *
 * On-demand LOW_FIT explanation recompute (docs/matching-engine.md
 * "Component persistence"): a LOW_FIT match persists only its total score
 * and classification (component rows are the dominant D1 growth term), so
 * opening one recomputes the breakdown live rather than reading rows that
 * don't exist. Determinism guarantee: the engine is pure and versioned
 * (ENGINE_VERSION) — recomputing with the SAME inputs (org profile, mapped
 * lot, and critically the ORIGINAL `scored_at` as the scoring-time clock,
 * so deadline-runway reproduces exactly) at the SAME engine version
 * reproduces the SAME score. Two things can break exact reproduction and
 * are handled honestly rather than silently: (1) the org's profile may have
 * changed since the match was scored — the recompute uses the CURRENT
 * profile, so a recomputed component sum could, in principle, no longer
 * equal the stored total (unusual — org profile edits are rare and the
 * result is still a valid score for the CURRENT profile, just not
 * necessarily equal to the historical one); (2) the stored match's
 * `engine_version` may not match the current `ENGINE_VERSION` (an
 * un-recomputed row from an old engine) — recompute is skipped entirely in
 * that case and the response carries a note instead of a fabricated
 * breakdown.
 */
import { zValidator } from '@hono/zod-validator';
import { Hono } from 'hono';
import { z } from 'zod';
import {
  createDb,
  getCustomerFeedback,
  getTenderDetailBundle,
  getTenderMatchLotNotice,
  getTenderMatchWithComponents,
  ignoreTender,
  insertProductEvent,
  isTenderIgnored,
  isTenderSaved,
  loadLotScoringBundlesByIds,
  saveTender,
  TenantMismatchError,
  unignoreTender,
  unsaveTender,
  upsertCustomerFeedback,
  type MatchComponentKey,
} from '@bidmorrow/db';
import { loadOrgProfile, mapLotToEngineInput } from '@bidmorrow/procurement';
import { ENGINE_VERSION, scoreLotForOrg } from '@bidmorrow/matching';
import type { ComponentResult, MatchComponentId, RiskFlag } from '@bidmorrow/matching';

import type { AppBindings } from '../env';
import { requireOrganization } from '../middleware/organization';
import { rateLimitOrgApi } from '../middleware/rate-limit';
import { requireSession } from '../middleware/session';

const matchIdParamSchema = z.object({ matchId: z.string().trim().min(1).max(64) }).strict();

const feedbackSchema = z
  .object({
    verdict: z.enum(['useful', 'not_useful']),
    reasons: z
      .array(
        z.enum([
          'wrong_cpv',
          'wrong_geography',
          'too_large',
          'too_small',
          'not_our_work',
          'deadline_too_close',
          'other',
        ]),
      )
      .max(7)
      .optional(),
    comment: z.string().trim().max(500).nullable().optional(),
  })
  .strict();

/** Mirrors packages/procurement/src/score.ts's private map — engine component id -> DB CHECK vocabulary. */
const COMPONENT_KEY_TO_DB: Record<MatchComponentId, MatchComponentKey> = {
  cpv: 'cpv',
  capability: 'capability',
  geography: 'geography',
  value: 'value',
  buyer: 'buyer',
  procedure: 'procedure_nature',
  deadline: 'deadline',
  eligibility: 'eligibility',
};

interface ComponentOut {
  componentKey: string;
  points: number;
  maxPoints: number;
  status: string;
  explanation: string;
}

interface RiskFlagOut {
  type: string;
  evidence: string;
  sourceField: string;
  confidence: string;
  explanation: string;
}

function parseLanguages(sourceLanguagesJson: string): string[] {
  try {
    const parsed: unknown = JSON.parse(sourceLanguagesJson);
    return Array.isArray(parsed) ? parsed.filter((l): l is string => typeof l === 'string') : [];
  } catch {
    return [];
  }
}

export const tendersRoutes = new Hono<AppBindings>();

tendersRoutes.use('*', rateLimitOrgApi);
tendersRoutes.use('*', requireSession);
tendersRoutes.use('*', requireOrganization);

tendersRoutes.get('/tenders/:matchId', zValidator('param', matchIdParamSchema), async (c) => {
  const db = createDb(c.env.DB);
  const organizationId = c.get('organizationId');
  if (organizationId === undefined) return c.json({ error: 'no_organization' }, 403);
  const { matchId } = c.req.valid('param');

  const matchBundle = await getTenderMatchWithComponents(db, organizationId, { matchId });
  if (matchBundle === null) return c.json({ error: 'not_found' }, 404);
  const { match } = matchBundle;

  const detail = await getTenderDetailBundle(db, { lotId: match.lotId });
  if (detail === null) return c.json({ error: 'not_found' }, 404);

  let components: ComponentOut[] = matchBundle.components.map((component) => ({
    componentKey: component.componentKey,
    points: component.points,
    maxPoints: component.maxPoints,
    status: component.status,
    explanation: component.explanation,
  }));
  let riskFlags: RiskFlagOut[] = matchBundle.riskFlags.map((flag) => ({
    type: flag.type,
    evidence: flag.evidence,
    sourceField: flag.sourceField,
    confidence: flag.confidence,
    explanation: flag.explanation,
  }));
  let explanationRecomputed = false;
  let explanationNote: string | null = null;

  // LOW_FIT matches persist score+classification only — recompute on demand.
  if (match.classification !== 'EXCLUDED' && components.length === 0) {
    if (match.engineVersion !== ENGINE_VERSION) {
      explanationNote =
        'This match was scored by a previous engine version, so a live explanation is not available; only the stored score is shown.';
    } else {
      const bundles = await loadLotScoringBundlesByIds(db, [match.lotId]);
      const bundle = bundles[0];
      if (bundle === undefined) {
        explanationNote =
          'The original tender data is no longer available, so only the stored score is shown.';
      } else {
        const mapped = await mapLotToEngineInput(db, bundle, match.scoredAt, c.get('logger'));
        if (mapped.kind === 'missing_main_cpv') {
          explanationNote =
            'The original tender data is no longer complete enough to recompute an explanation.';
        } else {
          const orgProfile = await loadOrgProfile(db, organizationId, c.get('logger'));
          const result = scoreLotForOrg({
            org: orgProfile,
            lot: mapped.lot,
            scoringTime: match.scoredAt,
          });
          if (result.kind === 'scored') {
            components = result.components.map((component: ComponentResult) => ({
              componentKey: COMPONENT_KEY_TO_DB[component.key],
              points: component.points,
              maxPoints: component.maxPoints,
              status: component.status,
              explanation: component.explanation,
            }));
            riskFlags = result.riskFlags.map((flag: RiskFlag) => ({
              type: flag.type,
              evidence: flag.evidence,
              sourceField: flag.sourceField,
              confidence: flag.confidence,
              explanation: flag.explanation,
            }));
            explanationRecomputed = true;
          } else {
            explanationNote = 'A live explanation could not be recomputed for this match.';
          }
        }
      }
    }
  }

  const [saved, ignored, feedback] = await Promise.all([
    isTenderSaved(db, organizationId, { lotId: match.lotId }),
    isTenderIgnored(db, organizationId, { lotId: match.lotId }),
    getCustomerFeedback(db, organizationId, { matchId }),
  ]);

  return c.json({
    match: {
      id: match.id,
      score: match.score,
      classification: match.classification,
      engineVersion: match.engineVersion,
      scoredAt: match.scoredAt,
      exclusionRule: match.exclusionRule,
      exclusionEvidence: match.exclusionEvidence,
    },
    lot: {
      id: detail.lot.id,
      lotNumber: detail.lot.lotNumber,
      title: detail.lot.title,
      description: detail.lot.description,
      contractNature: detail.lot.contractNature,
      estimatedValueAmount: detail.lot.estimatedValueAmount,
      estimatedValueCurrency: detail.lot.estimatedValueCurrency,
      estimatedValueEur: detail.lot.estimatedValueEur,
      valueIsDerived: detail.lot.valueIsDerived === 1,
      deadlineAt: detail.lot.deadlineAt,
      cpvCodes: detail.cpvCodes.map((code) => ({
        cpvCode: code.cpvCode,
        isMain: code.isMain === 1,
      })),
      geographies: detail.geographies.map((geo) => ({
        countryCode: geo.countryCode,
        nutsCode: geo.nutsCode,
      })),
    },
    notice: {
      id: detail.notice.id,
      sourceNoticeId: detail.notice.sourceNoticeId,
      source: detail.notice.source,
      sourceUrl: detail.notice.sourceUrl,
      publicationDate: detail.notice.publicationDate,
      procedureType: detail.notice.procedureType,
      noticeType: detail.notice.noticeType,
      languages: parseLanguages(detail.notice.sourceLanguagesJson),
    },
    buyerName: detail.buyerName,
    components,
    riskFlags,
    explanationRecomputed,
    explanationNote,
    savedByYou: saved,
    ignoredByYou: ignored,
    feedback:
      feedback === null
        ? null
        : {
            verdict: feedback.verdict,
            reasons:
              feedback.reasonsJson !== null ? (JSON.parse(feedback.reasonsJson) as string[]) : [],
            comment: feedback.comment,
          },
  });
});

tendersRoutes.post('/tenders/:matchId/save', zValidator('param', matchIdParamSchema), async (c) => {
  const db = createDb(c.env.DB);
  const organizationId = c.get('organizationId');
  const session = c.get('session');
  if (organizationId === undefined || session === undefined)
    return c.json({ error: 'no_organization' }, 403);
  const { matchId } = c.req.valid('param');
  const resolved = await getTenderMatchLotNotice(db, organizationId, { matchId });
  if (resolved === null) return c.json({ error: 'not_found' }, 404);
  const changed = await saveTender(db, organizationId, {
    lotId: resolved.lotId,
    noticeId: resolved.noticeId,
    savedByUserId: session.user.id,
  });
  await insertProductEvent(db, {
    organizationId,
    userId: session.user.id,
    name: 'match_saved',
    propertiesJson: JSON.stringify({ matchId }),
  });
  return c.json({ saved: true, changed });
});

tendersRoutes.post(
  '/tenders/:matchId/unsave',
  zValidator('param', matchIdParamSchema),
  async (c) => {
    const db = createDb(c.env.DB);
    const organizationId = c.get('organizationId');
    if (organizationId === undefined) return c.json({ error: 'no_organization' }, 403);
    const { matchId } = c.req.valid('param');
    const resolved = await getTenderMatchLotNotice(db, organizationId, { matchId });
    if (resolved === null) return c.json({ error: 'not_found' }, 404);
    const changed = await unsaveTender(db, organizationId, { lotId: resolved.lotId });
    return c.json({ saved: false, changed });
  },
);

tendersRoutes.post(
  '/tenders/:matchId/ignore',
  zValidator('param', matchIdParamSchema),
  async (c) => {
    const db = createDb(c.env.DB);
    const organizationId = c.get('organizationId');
    const session = c.get('session');
    if (organizationId === undefined || session === undefined)
      return c.json({ error: 'no_organization' }, 403);
    const { matchId } = c.req.valid('param');
    const resolved = await getTenderMatchLotNotice(db, organizationId, { matchId });
    if (resolved === null) return c.json({ error: 'not_found' }, 404);
    const changed = await ignoreTender(db, organizationId, {
      lotId: resolved.lotId,
      noticeId: resolved.noticeId,
      ignoredByUserId: session.user.id,
    });
    await insertProductEvent(db, {
      organizationId,
      userId: session.user.id,
      name: 'match_ignored',
      propertiesJson: JSON.stringify({ matchId }),
    });
    return c.json({ ignored: true, changed });
  },
);

tendersRoutes.post(
  '/tenders/:matchId/unignore',
  zValidator('param', matchIdParamSchema),
  async (c) => {
    const db = createDb(c.env.DB);
    const organizationId = c.get('organizationId');
    if (organizationId === undefined) return c.json({ error: 'no_organization' }, 403);
    const { matchId } = c.req.valid('param');
    const resolved = await getTenderMatchLotNotice(db, organizationId, { matchId });
    if (resolved === null) return c.json({ error: 'not_found' }, 404);
    const changed = await unignoreTender(db, organizationId, { lotId: resolved.lotId });
    return c.json({ ignored: false, changed });
  },
);

tendersRoutes.post(
  '/tenders/:matchId/feedback',
  zValidator('param', matchIdParamSchema),
  zValidator('json', feedbackSchema),
  async (c) => {
    const db = createDb(c.env.DB);
    const organizationId = c.get('organizationId');
    const session = c.get('session');
    if (organizationId === undefined || session === undefined) {
      return c.json({ error: 'no_organization' }, 403);
    }
    const { matchId } = c.req.valid('param');
    const body = c.req.valid('json');
    let feedback;
    try {
      feedback = await upsertCustomerFeedback(db, organizationId, {
        matchId,
        userId: session.user.id,
        verdict: body.verdict,
        ...(body.reasons !== undefined ? { reasons: body.reasons } : {}),
        comment: body.comment ?? null,
      });
    } catch (cause) {
      if (cause instanceof TenantMismatchError) return c.json({ error: 'not_found' }, 404);
      throw cause;
    }
    await insertProductEvent(db, {
      organizationId,
      userId: session.user.id,
      name: body.verdict === 'useful' ? 'feedback_useful' : 'feedback_not_useful',
      propertiesJson: JSON.stringify({ matchId }),
    });
    return c.json({
      feedback: {
        verdict: feedback.verdict,
        reasons:
          feedback.reasonsJson !== null ? (JSON.parse(feedback.reasonsJson) as string[]) : [],
        comment: feedback.comment,
      },
    });
  },
);
