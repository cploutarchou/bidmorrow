/**
 * Migration bootstrap sentinel (real D1 in workerd).
 *
 * The suite setup (src/test/apply-migrations.ts) applies every file in
 * /migrations to a completely empty database — reaching these assertions at
 * all proves the chain applies cleanly from scratch. The tests then assert
 * the outcome: every expected application table exists (including the
 * Better Auth core tables added in 0003), the 0001 `_bootstrap` placeholder
 * was dropped by 0002, and all three migrations are recorded.
 */
import { env } from 'cloudflare:workers';
import { describe, expect, it } from 'vitest';

/** Every application table 0002_core_schema.sql must create (docs/data-model.md). */
const EXPECTED_TABLES = [
  'audit_events',
  'billing_events',
  'buyers',
  'company_capabilities',
  'company_certifications',
  'company_cpv_preferences',
  'company_exclusions',
  'company_geographies',
  'company_keywords',
  'company_profiles',
  'customer_feedback',
  'digest_items',
  'digest_preferences',
  'digest_runs',
  'email_deliveries',
  'exchange_rates',
  'feature_flags',
  'ignored_tenders',
  'ingestion_checkpoints',
  'ingestion_errors',
  'ingestion_fetch_retries',
  'ingestion_runs',
  'match_components',
  'match_risk_flags',
  'matching_preferences',
  'organization_members',
  'organizations',
  'product_events',
  'saved_tenders',
  'source_snapshots',
  'subscriptions',
  'support_notes',
  'tender_cpv_codes',
  'tender_geographies',
  'tender_lots',
  'tender_matches',
  'tender_notice_versions',
  'tender_notices',
  'users',
  'auth_accounts',
  'auth_sessions',
  'auth_verifications',
  'auth_rate_limits',
] as const;

async function listTables(): Promise<Set<string>> {
  const result = await env.DB.prepare(
    "SELECT name FROM sqlite_master WHERE type = 'table' ORDER BY name",
  ).all<{ name: string }>();
  return new Set(result.results.map((row) => row.name));
}

describe('migrations apply from an empty database', () => {
  it('creates every expected application table', async () => {
    const tables = await listTables();
    const missing = EXPECTED_TABLES.filter((table) => !tables.has(table));
    expect(missing).toEqual([]);
  });

  it('drops the 0001 _bootstrap placeholder (0002 removes it)', async () => {
    const tables = await listTables();
    expect(tables.has('_bootstrap')).toBe(false);
  });

  it('records all nine migrations in d1_migrations', async () => {
    const result = await env.DB.prepare('SELECT name FROM d1_migrations ORDER BY name').all<{
      name: string;
    }>();
    expect(result.results.map((row) => row.name)).toEqual([
      '0001_init.sql',
      '0002_core_schema.sql',
      '0003_auth_tables.sql',
      '0004_admin_suspension.sql',
      '0005_nullable_authorship.sql',
      '0006_org_created_by_nullable.sql',
      '0007_tender_matches_score_index.sql',
      '0008_ingestion_fetch_retries.sql',
      '0009_ingestion_render_pending.sql',
    ]);
  });

  it('0004 adds organizations.suspended_at (Phase 10 stage A)', async () => {
    const columns = await env.DB.prepare('PRAGMA table_info(organizations)').all<{
      name: string;
    }>();
    expect(columns.results.map((c) => c.name)).toContain('suspended_at');
  });

  it('0005 makes saved_tenders/ignored_tenders/customer_feedback author columns nullable (Phase 11 stage A)', async () => {
    const cases: [string, string][] = [
      ['saved_tenders', 'saved_by_user_id'],
      ['ignored_tenders', 'ignored_by_user_id'],
      ['customer_feedback', 'user_id'],
    ];
    for (const [table, column] of cases) {
      const columns = await env.DB.prepare(`PRAGMA table_info(${table})`).all<{
        name: string;
        notnull: number;
      }>();
      const info = columns.results.find((c) => c.name === column);
      expect(info?.notnull).toBe(0);
    }
  });

  it('0006 makes organizations.created_by_user_id nullable (Phase 11 stage A)', async () => {
    const columns = await env.DB.prepare('PRAGMA table_info(organizations)').all<{
      name: string;
      notnull: number;
    }>();
    const info = columns.results.find((c) => c.name === 'created_by_user_id');
    expect(info?.notnull).toBe(0);
  });

  it('0007 adds idx_tender_matches__org_engine_score_id (Phase 12 stage B fix P-1)', async () => {
    const result = await env.DB.prepare(
      "SELECT name FROM sqlite_master WHERE type = 'index' AND tbl_name = 'tender_matches' ORDER BY name",
    ).all<{ name: string }>();
    expect(result.results.map((row) => row.name)).toContain(
      'idx_tender_matches__org_engine_score_id',
    );
  });

  it('0008 creates ingestion_fetch_retries with its unique + partial drain indexes (ADR-0008 §3)', async () => {
    // `sqlite_autoindex_ingestion_fetch_retries_1` is SQLite's implicit
    // index backing the non-INTEGER TEXT PRIMARY KEY (every table in this
    // schema has one) — present but irrelevant here, so this asserts the
    // two migration-authored indexes exist rather than the full set.
    const indexes = await env.DB.prepare(
      "SELECT name FROM sqlite_master WHERE type = 'index' AND tbl_name = 'ingestion_fetch_retries' ORDER BY name",
    ).all<{ name: string }>();
    expect(indexes.results.map((row) => row.name)).toEqual(
      expect.arrayContaining([
        'idx_ingestion_fetch_retries__pending_next_attempt_at',
        'uq_ingestion_fetch_retries__source_source_notice_id',
      ]),
    );

    const columns = await env.DB.prepare('PRAGMA table_info(ingestion_fetch_retries)').all<{
      name: string;
      notnull: number;
      dflt_value: string | null;
    }>();
    const byName = new Map(columns.results.map((c) => [c.name, c]));
    expect(byName.get('status')?.dflt_value).toBe("'pending'");
    expect(byName.get('attempts')?.dflt_value).toBe('0');
    expect(byName.get('last_error_code')?.notnull).toBe(1);
  });

  it('0008 adds ingestion_runs.notices_fetch_failed defaulted to 0 (ADR-0008 §5)', async () => {
    const columns = await env.DB.prepare('PRAGMA table_info(ingestion_runs)').all<{
      name: string;
      notnull: number;
      dflt_value: string | null;
    }>();
    const info = columns.results.find((c) => c.name === 'notices_fetch_failed');
    expect(info?.notnull).toBe(1);
    expect(info?.dflt_value).toBe('0');
  });

  it('0009 adds ingestion_runs.notices_render_pending defaulted to 0 (ADR-0009 §1)', async () => {
    const columns = await env.DB.prepare('PRAGMA table_info(ingestion_runs)').all<{
      name: string;
      notnull: number;
      dflt_value: string | null;
    }>();
    const info = columns.results.find((c) => c.name === 'notices_render_pending');
    expect(info?.notnull).toBe(1);
    expect(info?.dflt_value).toBe('0');
  });
});
