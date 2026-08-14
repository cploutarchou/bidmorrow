---
name: run-quality-gates
description: Run the standard BidMorrow quality gates (format, lint, typecheck, tests, build) and report real results. Use before committing, before declaring any task/phase done, and during independent review.
---

# Run quality gates

## Commands (run from repo root)

```bash
pnpm install --frozen-lockfile   # only if node_modules is stale
pnpm format:check
pnpm lint
pnpm typecheck
pnpm test            # or a scoped filter for the touched packages
pnpm build
```

Scoped runs are fine during iteration (`pnpm --filter <pkg> test`), but a
"gates green" claim requires the full set at least once.

## Rules

- Report the ACTUAL results: command, exit status, failure counts. Never
  claim a gate ran unless it did; never summarize a failure as a pass.
- A red gate blocks completion. Fix it or report it as a known failure in
  the ledger — do not delete/skip tests, suppress errors, or loosen lint
  rules to get green.
- If a gate script doesn't exist yet (early phases), state which gates are
  not yet configured instead of skipping silently.
