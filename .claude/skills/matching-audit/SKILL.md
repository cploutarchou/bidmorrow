---
name: matching-audit
description: Audit the matching engine against its specification - determinism, component sums, unknown handling, hard exclusions, hierarchical CPV gradient, risk-flag evidence, and engine versioning. Use during phase review of matching work and after any scoring change.
---

# Matching audit

Spec of record: docs/matching-engine.md. Verify code and tests against it.

## Checklist

1. **Deterministic**: same inputs + engine version ⇒ identical output; no
   randomness, no wall-clock dependence except the documented `scored_at`
   deadline computation; property test or repeated-run test exists.
2. **Components sum**: total equals the sum of stored components; caps
   respected (CPV 35, capability 20, geography 15, value 10, buyer 5,
   procedure 5, deadline 5, eligibility 5).
3. **Hierarchical CPV**: gradient implemented per spec table (exact >
   category > class > group > division), additional-CPV discount applied,
   tests cover each level.
4. **UNKNOWN policy**: unknown components score the documented neutral
   fraction (never 0, never max), status recorded in match_components,
   explanation renders the unknown reason. Language-limited keyword matching
   marked UNKNOWN with the source-language indicator — never penalized.
5. **Hard exclusions**: only fire on KNOWN values; each records rule +
   evidence; all five rules tested; unknown fields never exclude.
6. **Risk flags**: every flag carries type, quoted source evidence, field
   reference, confidence, explanation. No flag without evidence — grep for
   any path that emits a flag from inference rather than matched text.
   POSSIBLE-confidence wording says "verify in source documents".
7. **Versioning**: ENGINE_VERSION stored on every match; any scoring change
   in the diff bumped it; recomputation is admin-only and bounded.
8. **Classification thresholds**: 80/65/45 boundaries tested inclusively.

Report per item: PASS/FAIL, file:line evidence, covering test name.
