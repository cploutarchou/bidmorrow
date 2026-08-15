/**
 * STRUCTURAL tenant-isolation contract test — the grep-auditable rule of
 * .claude/skills/tenant-isolation-audit/SKILL.md as an executable test.
 *
 * Contract: every exported repository function in packages/db that touches
 * tenant-owned tables takes `db: Db` first and `organizationId:
 * OrganizationId` second. Exceptions are explicit, named, and justified
 * below — adding a repository file or an org-less function without
 * classifying it here FAILS this test.
 *
 * Runs in the ROOT vitest node project (plain `node:fs`, no workerd): the
 * repository *source* is the artifact under test, not the database. The
 * behavioral counterpart (real cross-tenant queries against local D1) lives
 * in packages/db/src/tenant-isolation.d1.test.ts.
 */
import { readdirSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const repositoriesDir = join(
  dirname(fileURLToPath(import.meta.url)),
  '..',
  '..',
  'packages',
  'db',
  'src',
  'repositories',
);

/** Files whose exported db-functions MUST take organizationId second. */
const TENANT_FILES = [
  'billing.ts',
  'company.ts',
  'engagement.ts',
  'identity.ts',
  'matching.ts',
  'ops.ts',
] as const;

/** Global (non-tenant) data: shared corpus, ingestion plumbing, ops config. */
const GLOBAL_FILES = ['ingestion.ts', 'ops-global.ts', 'retention.ts', 'tender-corpus.ts'] as const;

/**
 * Global files that legitimately import a tenant schema module, with a
 * written justification (checked below instead of the blanket ban).
 */
const GLOBAL_FILES_TENANT_SCHEMA_EXEMPT: Record<string, string> = {
  'retention.ts':
    'the retention purge sweep is a single global operational job (docs/ted-ingestion-scope.md) ' +
    "that must see EVERY organization's saved_tenders/customer_feedback pins to decide global " +
    "purge eligibility, and once a lot is purged must remove EVERY organization's matches on " +
    'it — by definition this cannot be organizationId-scoped: it reads saved_tenders/' +
    'customer_feedback (tenant-owned) read-only to compute pins, DELETEs tender_matches ' +
    '(tenant-owned — but scoped by lot_id across all organizations, not by a single ' +
    'organization_id, because a purged global lot must not leave orphaned matches behind for ' +
    'ANY tenant) and UPDATEs digest_items.match_id to NULL (tenant-owned via digest_run_id — ' +
    'detaching, never deleting, so historical digests stay readable after the match is gone). ' +
    'It never INSERTs into a tenant-owned table. No request-handler path reaches this module; ' +
    'it runs only from the scheduled retention job (ADR-0003), which is why the per-request ' +
    'organizationId contract does not apply here.',
};

/** Infrastructure helpers/errors — no data access of their own. */
const INFRA_FILES = ['errors.ts', 'shared.ts'] as const;

/**
 * Documented exceptions inside tenant files. Each entry must still exist in
 * its file (a stale exemption fails the suite).
 */
const TENANT_EXEMPT: Record<string, { name: string; reason: string }[]> = {
  'identity.ts': [
    { name: 'createOrganization', reason: 'creates the tenant — no organization exists yet' },
    { name: 'getOrganizationsForUser', reason: 'tenancy bootstrap: session user -> organizations' },
  ],
  'company.ts': [
    {
      name: 'listOrgsEligibleForScoring',
      reason:
        'the matching engine orchestration (packages/procurement/src/score.ts) must enumerate ' +
        'every eligible organization to score a given lot against — it is the scoring-pipeline ' +
        'equivalent of listing "all tenants", never reachable from a per-request/per-tenant ' +
        'handler, and returns only organization ids (no tenant-owned row data of its own).',
    },
    {
      name: 'listOrgsWithDigestEnabled',
      reason:
        'the digest scheduler (@bidmorrow/notifications selectDigestOrgs) must enumerate every ' +
        'digest-enabled organization across all tenants — same "list all tenants" rationale as ' +
        'listOrgsEligibleForScoring, never reachable from a per-request/per-tenant handler.',
    },
  ],
  'billing.ts': [
    {
      name: 'insertBillingEventIfNew',
      reason: 'Stripe webhook ledger; organizationId is nullable but EXPLICIT in args',
    },
    {
      name: 'getBillingEventByStripeId',
      reason:
        'idempotency/retry read on the same unique stripe_event_id ledger as insertBillingEventIfNew ' +
        '— distinguishes a true duplicate from a retryable failed/stuck row; organization_id is ' +
        'nullable on this table by design (see file header) and is not a lookup key here.',
    },
    {
      name: 'markBillingEventStatus',
      reason:
        'terminal-status transition on an already-recorded billing_events row, keyed on the ' +
        'unique stripe_event_id (which may itself be organization_id: null — unresolvable at ' +
        'insert time); never touches tenant-owned data.',
    },
    {
      name: 'countNonCanceledSubscriptionsByPlan',
      reason:
        'founding-plan seat-cap enforcement (packages/billing createCheckoutSession, and ' +
        'isFoundingPlanAvailable behind GET /api/billing/status) must count across every ' +
        'organization on a plan, the billing equivalent of company.ts ' +
        'listOrgsEligibleForScoring/listOrgsWithDigestEnabled — reachable from per-tenant ' +
        'handlers but returns only a bare global count, no tenant-owned row data (SEC-P9-04).',
    },
  ],
  'ops.ts': [
    {
      name: 'insertProductEvent',
      reason: 'analytics event; organizationId is nullable but EXPLICIT in args',
    },
    {
      name: 'insertAuditEvent',
      reason: 'audit ledger; organizationId is nullable but EXPLICIT in args',
    },
  ],
};

/** Exemptions that must still carry an explicit nullable organizationId in their args type. */
const EXEMPT_REQUIRING_EXPLICIT_NULLABLE_ORG = new Set([
  'insertBillingEventIfNew',
  'insertProductEvent',
  'insertAuditEvent',
]);

interface ExportedFunction {
  name: string;
  /** Top-level parameters, e.g. `db: Db`, `organizationId: OrganizationId`. */
  params: string[];
}

/**
 * Extracts every `export [async] function name(...)` with its top-level
 * parameter list, balancing (), {} and [] so nested types never split a
 * parameter. Intentionally simple: repository signatures are plain
 * (prettier-formatted, no comments inside parameter lists).
 */
function extractExportedFunctions(source: string): ExportedFunction[] {
  const results: ExportedFunction[] = [];
  const headerRe = /export (?:async )?function (\w+)\s*(?:<[^(]*?>)?\s*\(/g;
  let match: RegExpExecArray | null;
  while ((match = headerRe.exec(source)) !== null) {
    const name = match[1];
    if (name === undefined) continue;
    const params: string[] = [];
    let parens = 1;
    let braces = 0;
    let brackets = 0;
    let paramStart = headerRe.lastIndex;
    let i = headerRe.lastIndex;
    while (i < source.length && parens > 0) {
      const ch = source[i];
      if (ch === '(') parens += 1;
      else if (ch === ')') {
        parens -= 1;
        if (parens === 0) {
          const last = source.slice(paramStart, i).trim();
          if (last.length > 0) params.push(last);
        }
      } else if (ch === '{') braces += 1;
      else if (ch === '}') braces -= 1;
      else if (ch === '[') brackets += 1;
      else if (ch === ']') brackets -= 1;
      else if (ch === ',' && parens === 1 && braces === 0 && brackets === 0) {
        params.push(source.slice(paramStart, i).trim());
        paramStart = i + 1;
      }
      i += 1;
    }
    results.push({ name, params: params.map((p) => p.replace(/\s+/g, ' ')) });
  }
  return results;
}

function readRepositoryFile(file: string): string {
  return readFileSync(join(repositoriesDir, file), 'utf8');
}

const isDbFirst = (fn: ExportedFunction): boolean => /^db\s*:\s*Db\b/.test(fn.params[0] ?? '');

describe('tenant-isolation structural contract (packages/db/src/repositories)', () => {
  it('every repository source file is classified as tenant, global, or infra', () => {
    const classified = new Set<string>([...TENANT_FILES, ...GLOBAL_FILES, ...INFRA_FILES]);
    const sourceFiles = readdirSync(repositoriesDir)
      .filter((f: string) => f.endsWith('.ts') && !f.endsWith('.test.ts') && !f.endsWith('.d.ts'))
      .sort();
    const unclassified = sourceFiles.filter((f: string) => !classified.has(f));
    // A new repository file must be added to exactly one list above (and, if
    // tenant-owned, its functions must carry organizationId) — docs/security.md C6.
    expect(unclassified).toEqual([]);
    const missing = [...classified].filter((f) => !sourceFiles.includes(f));
    expect(missing).toEqual([]);
  });

  it('every exported db-function in tenant files has organizationId: OrganizationId as its first post-db parameter', () => {
    const violations: string[] = [];
    let conforming = 0;

    for (const file of TENANT_FILES) {
      const exempt = new Set((TENANT_EXEMPT[file] ?? []).map((e) => e.name));
      for (const fn of extractExportedFunctions(readRepositoryFile(file))) {
        if (!isDbFirst(fn)) {
          violations.push(`${file}:${fn.name} — first parameter must be \`db: Db\``);
          continue;
        }
        if (exempt.has(fn.name)) continue;
        const second = fn.params[1] ?? '';
        if (/^organizationId\s*:\s*OrganizationId$/.test(second)) {
          conforming += 1;
        } else {
          violations.push(
            `${file}:${fn.name} — second parameter must be \`organizationId: OrganizationId\`, got \`${second}\``,
          );
        }
      }
    }

    expect(violations).toEqual([]);
    // Parser-regression tripwire: silently matching nothing must fail too.
    expect(conforming).toBeGreaterThanOrEqual(25);
  });

  it('every exemption names a function that still exists (no stale allowlist)', () => {
    for (const [file, exemptions] of Object.entries(TENANT_EXEMPT)) {
      const names = new Set(extractExportedFunctions(readRepositoryFile(file)).map((f) => f.name));
      for (const { name } of exemptions) {
        expect(names, `${file} exemption '${name}' no longer exists — remove it`).toContain(name);
      }
    }
  });

  it('nullable-org exemptions keep organizationId explicit in their args type', () => {
    // These functions may not take a bare OrganizationId, but the tenant
    // linkage must stay visible and grep-auditable at every call site:
    // the declaring file must type it `organizationId: OrganizationId | null`.
    for (const name of EXEMPT_REQUIRING_EXPLICIT_NULLABLE_ORG) {
      const declaring = Object.entries(TENANT_EXEMPT).find(([, exemptions]) =>
        exemptions.some((e) => e.name === name),
      );
      expect(declaring, `exemption ${name} has no declaring file`).toBeDefined();
      if (declaring === undefined) continue;
      const source = readRepositoryFile(declaring[0]);
      expect(
        /organizationId\s*:\s*OrganizationId\s*\|\s*null/.test(source),
        `${declaring[0]} must declare \`organizationId: OrganizationId | null\` for ${name}`,
      ).toBe(true);
    }
  });

  it('global files never reference organization-owned schema tables', () => {
    // Global repositories operate on the shared corpus/ops tables only. An
    // import of a tenant schema area from a global file is a smell that
    // tenant data is being accessed without the organizationId contract.
    const tenantSchemaModules = ['../schema/company', '../schema/engagement', '../schema/billing'];
    for (const file of GLOBAL_FILES) {
      if (file in GLOBAL_FILES_TENANT_SCHEMA_EXEMPT) {
        continue; // documented exception above
      }
      const source = readRepositoryFile(file);
      for (const module of tenantSchemaModules) {
        expect(
          source.includes(`'${module}'`),
          `${file} imports ${module} — tenant tables require the organizationId contract`,
        ).toBe(false);
      }
    }
  });

  it('retention.ts never INSERTs into a tenant-owned table (SEC-P5-03)', () => {
    // The exemption above justifies retention.ts's cross-tenant UPDATE
    // (digest_items) and DELETE (tender_matches) as read-then-cascade-delete
    // operations against ALREADY-EXISTING tenant data — it must never
    // originate new tenant-owned rows, which would need an organizationId
    // the global purge job has no business assigning.
    const source = readRepositoryFile('retention.ts');
    expect(source.includes('.insert(')).toBe(false);
  });

  it('every global tenant-schema exemption names a file that actually imports a tenant schema module', () => {
    const tenantSchemaModules = ['../schema/company', '../schema/engagement', '../schema/billing'];
    for (const [file, reason] of Object.entries(GLOBAL_FILES_TENANT_SCHEMA_EXEMPT)) {
      expect(reason.length, `${file} exemption needs a non-empty justification`).toBeGreaterThan(0);
      const source = readRepositoryFile(file);
      const importsAny = tenantSchemaModules.some((module) => source.includes(`'${module}'`));
      expect(
        importsAny,
        `${file} is exempted but imports no tenant schema module — remove it`,
      ).toBe(true);
    }
  });
});
