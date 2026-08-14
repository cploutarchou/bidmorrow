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
const GLOBAL_FILES = ['ingestion.ts', 'ops-global.ts', 'tender-corpus.ts'] as const;

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
  'billing.ts': [
    {
      name: 'insertBillingEventIfNew',
      reason: 'Stripe webhook ledger; organizationId is nullable but EXPLICIT in args',
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
      const source = readRepositoryFile(file);
      for (const module of tenantSchemaModules) {
        expect(
          source.includes(`'${module}'`),
          `${file} imports ${module} — tenant tables require the organizationId contract`,
        ).toBe(false);
      }
    }
  });
});
