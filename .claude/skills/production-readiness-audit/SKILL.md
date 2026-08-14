---
name: production-readiness-audit
description: Run the full Definition of Done verification for a phase or for the final production audit. Use for phase sign-offs and to produce PRODUCTION_READINESS_AUDIT.md findings.
---

# Production readiness audit

The Definition of Done lives in the master spec (mirrored in
docs/production-checklist.md). "Production ready" may not be claimed while
any mandatory item is unverified or failing.

## Procedure

1. Re-run all quality gates yourself (run-quality-gates skill) — fresh
   install with frozen lockfile, format, lint, typecheck, all test suites,
   build. Record actual outputs.
2. Verify migrations apply from an empty database.
3. Walk docs/production-checklist.md item by item. For each: EXECUTE the
   verification (run the test, read the code, check the config) — a claim in
   the ledger is not evidence.
4. Security posture: confirm security agent sign-off exists for the phase;
   confirm 0 CRITICAL and 0 HIGH open findings; run the tenant-isolation-
   audit grep pass yourself on changed code.
5. Cost: confirm docs/cost-model.md is current (cost-audit skill) and under
   budget including the 12-month D1 projection.
6. Findings format (for PRODUCTION_READINESS_AUDIT.md): ID, category,
   severity (CRITICAL/HIGH/MEDIUM/LOW/INFO), description, evidence,
   impact, remediation, status. Every CRITICAL and HIGH must be resolved
   before readiness is declared.
7. Verdict is binary per phase: PASS (recorded in ledger with date and gate
   outputs) or FAIL (findings list). Never a qualified pass on a mandatory
   item.
