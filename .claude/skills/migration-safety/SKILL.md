---
name: migration-safety
description: Checklist and procedure for authoring and deploying D1 schema migrations safely. Use for every migration created, and before any staging/production migration deploy.
---

# Migration safety (Cloudflare D1 / SQLite)

Migrations are one-way doors. Every schema change follows this checklist.

## Authoring

1. One numbered SQL file per change under migrations/ (wrangler d1 migrations
   naming: `NNNN_description.sql`). Keep Drizzle schema in packages/db in
   sync in the same commit.
2. SQLite constraints apply: `ALTER TABLE` supports ADD COLUMN / RENAME only.
   Column drops/retypes require the create-new → copy → swap pattern; write
   it explicitly and test it.
3. New organization-owned tables MUST have `organization_id` (FK, indexed).
   Add unique constraints for real invariants at creation time — adding them
   later requires table rebuilds.
4. Additive first: prefer nullable-with-backfill over NOT NULL on existing
   tables; a NOT NULL addition needs a DEFAULT or a rebuild.
5. No data-destructive statement (DROP, DELETE, retyping) without an explicit
   note in the migration header comment stating what is lost and why.
6. `--` line comments ONLY — never `/* */` block comments. wrangler's
   `--remote` path splits statements before the D1 HTTP API and mishandles
   block comments inside a statement, failing the apply with SQLITE_ERROR
   "incomplete input" [7500]. The local apply path parses them fine, so CI's
   from-empty chain apply does NOT catch this — it first surfaces on the
   staging deploy (0010, 2026-08-24).

## Verification (every migration)

```bash
pnpm db:migrate:local          # apply full chain to a fresh local D1
pnpm test --filter @bidmorrow/db   # repository integration tests
```

CI applies the entire chain from an empty database on every PR. For
migrations altering existing tables, also run the upgrade against a database
seeded at the prior schema (tests/integration/migrations).

## Production deploy

1. Staging first, always; run smoke tests.
2. Record a D1 Time Travel bookmark immediately before applying
   (`wrangler d1 time-travel info` — exact command per docs/backup-restore.md)
   and write it into the deploy log/ledger.
3. Apply via the documented procedure in docs/deployment.md only — never
   ad-hoc `d1 execute` against production.
4. Decide and record rollback vs fix-forward before applying, not after.
