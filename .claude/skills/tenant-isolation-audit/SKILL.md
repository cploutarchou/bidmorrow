---
name: tenant-isolation-audit
description: Structured audit for cross-tenant data isolation. Use during security review of any phase touching organization-owned data, and whenever a new table, repository, or endpoint is added. Any failure is Critical severity.
---

# Tenant isolation audit

Structural rule: ALL organization-scoped data access goes through repository
functions that REQUIRE organizationId. Isolation must be reviewable by grep,
not only by tests.

## Grep audit

1. Enumerate organization-owned tables (schema in packages/db — any table
   with organization_id, plus tables reachable only through one).
2. For each, grep the codebase for direct query-builder/SQL references to the
   table OUTSIDE packages/db repositories. Any hit in a handler/service that
   bypasses the repository layer is a finding.
3. In each repository function touching those tables: confirm organizationId
   is a required parameter and appears in the WHERE clause / inserted row of
   EVERY statement — including UPDATE/DELETE (scoped by both id AND
   organization_id) and JOINs.
4. Grep handlers for organization identifiers taken from request
   body/params/query and used for data access — the org context must come
   from the authenticated session/membership, never from client input.
5. Check admin endpoints: gated by INTERNAL_ADMIN server-side, audited, and
   not reachable via customer routes.

## Test audit

Confirm executable tests exist and pass for: Org A reading B's profile /
matches / preferences / saved tenders / billing metadata; Org A modifying B's
preference; member privilege escalation; normal user calling admin endpoints.
Each must assert 403/404 AND that no cross-tenant data appears in the body.

## Report

Per table and per endpoint: PASS/FAIL with file:line evidence. Any failure is
CRITICAL. No sign-off while a CRITICAL is open.
