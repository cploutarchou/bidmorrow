# ADR-0007: Domain-owned tenancy tables; Better Auth core only (supersedes ADR-0002 §org-plugin)

Status: Accepted (2026-08-14). Partially supersedes ADR-0002 (only the
"organization plugin models organizations/memberships/roles" line; the
adapter route is unchanged).

## Context

ADR-0002 proposed using Better Auth's first-party organization plugin for
tenancy. Phase 3 then implemented `organizations` and `organization_members`
exactly per docs/data-model.md — with the organizationId-required repository
layer, structural contract test, tenant-isolation D1 test suite, and a
security sign-off built on those tables. Better Auth's organization plugin
generates its own `organization`/`member`/`invitation` tables with different
names, shapes, and access paths; adopting it now would duplicate the tenancy
layer, split authorization between our repositories and plugin endpoints,
and invalidate the audited isolation surface.

## Decision

- Better Auth is used for **authentication only** (core: users, sessions,
  accounts, verifications; email verification, password reset, rate
  limiting) via the official Drizzle adapter over D1 (ADR-0002 route
  unchanged).
- **Tenancy stays domain-owned**: `organizations` + `organization_members`
  and the repository layer are the single authority for org membership and
  roles (ORGANIZATION_OWNER, MEMBER). Organization context middleware
  resolves the org from the Better Auth session's user via
  `organization_members` — never from client input.
- Better Auth's organization plugin is not enabled. Invitation/team
  features, if ever needed, are built on our tables or this ADR is
  superseded again with a migration plan.
- INTERNAL_ADMIN remains an `ADMIN_EMAILS` allowlist check (data-model
  decision), not a role row.

## Consequences

- Auth schema (migration 0003) contains only Better Auth core tables
  reconciled with the Phase 3 `users` placeholder; no plugin tables.
- Membership/role endpoints are ours, covered by the same repository
  contract and isolation tests — one authorization model, grep-auditable.
- We forgo the plugin's ready-made invitation flows (out of V1 scope
  anyway; memberships are modeled, only owner UI ships in V1).
