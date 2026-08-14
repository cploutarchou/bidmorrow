/**
 * Tenant-linked ops repository: product analytics events, audit events and
 * support notes — docs/data-model.md §10 (docs/security.md C6).
 *
 * `product_events` and `audit_events` take an EXPLICIT
 * `organizationId: OrganizationId | null` (both columns are nullable per
 * the doc — anonymous/marketing events, system-wide audit actions) so the
 * tenant linkage stays visible and grep-auditable at every call site.
 * `support_notes` is fully [tenant-owned]. Global ops tables
 * (`feature_flags`) live in the global repository files, never here.
 *
 * Reading `audit_events` is an INTERNAL_ADMIN concern outside Phase 3
 * scope; this module only writes them.
 */
import { and, desc, eq, lt, or } from 'drizzle-orm';
import type { OrganizationId } from '@bidmorrow/domain';

import type { Db } from '../client';
import { newId } from '../id';
import { auditEvents, productEvents, supportNotes } from '../schema/ops';
import { normalizeLimit, toPage, type Page, type Pagination } from './shared';

export type ProductEvent = typeof productEvents.$inferSelect;
export type AuditEvent = typeof auditEvents.$inferSelect;
export type SupportNote = typeof supportNotes.$inferSelect;

export type AuditActorType = 'user' | 'admin' | 'system';

// ---------------------------------------------------------------------------
// product_events (append-only)
// ---------------------------------------------------------------------------

export interface InsertProductEventArgs {
  /** Null for anonymous/marketing events. */
  organizationId: OrganizationId | null;
  userId?: string | null;
  /** e.g. `feed_viewed`, `digest_opened`, `match_expanded`. */
  name: string;
  /** Opaque JSON document. */
  propertiesJson?: string | null;
}

export async function insertProductEvent(
  db: Db,
  args: InsertProductEventArgs,
): Promise<ProductEvent> {
  const now = Date.now();
  const rows = await db
    .insert(productEvents)
    .values({
      id: newId(now),
      organizationId: args.organizationId,
      userId: args.userId ?? null,
      name: args.name,
      propertiesJson: args.propertiesJson ?? null,
      createdAt: now,
    })
    .returning();
  const row = rows[0];
  if (row === undefined) {
    throw new Error('insertProductEvent: insert returned no row');
  }
  return row;
}

// ---------------------------------------------------------------------------
// audit_events (append-only; written here, read by INTERNAL_ADMIN tooling)
// ---------------------------------------------------------------------------

export interface InsertAuditEventArgs {
  actorType: AuditActorType;
  /** users.id for user/admin actors, null for system. */
  actorId?: string | null;
  /** The organization affected, when applicable. */
  organizationId: OrganizationId | null;
  /** Stable verb, e.g. `feature_flag.updated`, `org.deleted`. */
  action: string;
  /** e.g. `feature_flag`, `organization`, `subscription`. */
  targetType: string;
  targetId?: string | null;
  beforeSummary?: string | null;
  afterSummary?: string | null;
  /** When the action happened (may predate the insert). */
  occurredAt: number;
}

export async function insertAuditEvent(db: Db, args: InsertAuditEventArgs): Promise<AuditEvent> {
  const now = Date.now();
  const rows = await db
    .insert(auditEvents)
    .values({
      id: newId(now),
      actorType: args.actorType,
      actorId: args.actorId ?? null,
      organizationId: args.organizationId,
      action: args.action,
      targetType: args.targetType,
      targetId: args.targetId ?? null,
      beforeSummary: args.beforeSummary ?? null,
      afterSummary: args.afterSummary ?? null,
      occurredAt: args.occurredAt,
      createdAt: now,
    })
    .returning();
  const row = rows[0];
  if (row === undefined) {
    throw new Error('insertAuditEvent: insert returned no row');
  }
  return row;
}

// ---------------------------------------------------------------------------
// support_notes — [tenant-owned]; INTERNAL_ADMIN visibility enforced in the
// app layer (author must pass the admin allowlist check), never rendered to
// customers.
// ---------------------------------------------------------------------------

export async function insertSupportNote(
  db: Db,
  organizationId: OrganizationId,
  args: { authorUserId: string; body: string },
): Promise<SupportNote> {
  const now = Date.now();
  const rows = await db
    .insert(supportNotes)
    .values({
      id: newId(now),
      organizationId,
      authorUserId: args.authorUserId,
      body: args.body,
      createdAt: now,
      updatedAt: now,
    })
    .returning();
  const row = rows[0];
  if (row === undefined) {
    throw new Error('insertSupportNote: insert returned no row');
  }
  return row;
}

/** Cursor: `${createdAt}:${id}` of the last row. */
function decodeNoteCursor(cursor: string): { createdAt: number; id: string } {
  const separator = cursor.indexOf(':');
  const createdAt = separator > 0 ? Number(cursor.slice(0, separator)) : Number.NaN;
  const id = separator > 0 ? cursor.slice(separator + 1) : '';
  if (!Number.isFinite(createdAt) || id.length === 0) {
    throw new Error('listSupportNotes: malformed cursor');
  }
  return { createdAt, id };
}

/**
 * Newest-first support notes for an organization (backed by
 * `idx_support_notes__organization_id_created_at`).
 */
export async function listSupportNotes(
  db: Db,
  organizationId: OrganizationId,
  args: Pagination = {},
): Promise<Page<SupportNote>> {
  const limit = normalizeLimit(args.limit);
  const conditions = [eq(supportNotes.organizationId, organizationId)];
  if (args.cursor !== undefined) {
    const cursor = decodeNoteCursor(args.cursor);
    const keyset = or(
      lt(supportNotes.createdAt, cursor.createdAt),
      and(eq(supportNotes.createdAt, cursor.createdAt), lt(supportNotes.id, cursor.id)),
    );
    if (keyset !== undefined) conditions.push(keyset);
  }
  const rows = await db
    .select()
    .from(supportNotes)
    .where(and(...conditions))
    .orderBy(desc(supportNotes.createdAt), desc(supportNotes.id))
    .limit(limit + 1);
  return toPage(rows, limit, (last) => `${last.createdAt}:${last.id}`);
}
