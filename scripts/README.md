# scripts/

Manual, local-only helper scripts. Nothing in this directory is executed by
CI, migrations, cron, or any automated process.

## seed-demo.sql

Demo seed data for **local development only** — a fake demo organization
("Acme Cyber Consulting", id `org_demo_acme`), demo user
(`demo@acme-cyber.example`), company profile/preferences, and two clearly
fake tender notices (`TED-DEMO-001`, `TED-DEMO-002`) so the feed has data in
dev. Every row uses fixed ids prefixed `demo_` and all inserts are
`INSERT OR IGNORE`, so re-running is a no-op.

**NEVER run this against staging or production.** Local `--local` execution
only; the file header repeats this warning.

### Prerequisites

Migrations `0001` + `0002` must be applied first.

### Apply (manually, from `apps/worker`)

`wrangler d1 execute --file` resolves relative to the current working
directory, so use an absolute path to avoid ambiguity:

```sh
cd apps/worker
npx wrangler d1 migrations apply bidmorrow --local
npx wrangler d1 execute bidmorrow --local \
  --file "$(git rev-parse --show-toplevel)/scripts/seed-demo.sql"
```

(Equivalently, from `apps/worker` the relative form is
`--file ../../scripts/seed-demo.sql`.)

### Verify

```sh
npx wrangler d1 execute bidmorrow --local \
  --command "SELECT id, name FROM organizations WHERE id = 'org_demo_acme'"
```

### Remove the demo data

Delete the local D1 state and re-apply migrations (fastest), or delete rows
whose ids start with `demo_` / the `org_demo_acme` org in FK-child-first
order.
