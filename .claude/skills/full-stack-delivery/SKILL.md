---
name: full-stack-delivery
description: End-to-end delivery procedure for a production issue or small feature that spans UI, API, auth, notifications or billing state. Use when a user-visible problem needs a vertical-slice fix with tests at every touched layer, and before reporting any such fix as done.
argument-hint: '[issue description]'
---

# Full-stack delivery (vertical slice)

Issue: $ARGUMENTS

Deliver the fix as ONE complete vertical slice. Work through every step;
skipping a step is a reason to say so, never a shortcut.

## 1. Reproduce and trace (before any edit)

- Find the exact user path: page/component → API route → middleware →
  service → repository → schema. Name each file.
- Write down, in one paragraph, what happens today and the precise cause.
  If you cannot state the cause, keep reading — do not guess-fix.
- Check whether an ADR, a `docs/` page or a test already specifies the
  intended behaviour. If the intended behaviour is genuinely undecided,
  record the decision you are making and why.

## 2. Fix every layer the cause touches

Typical layers, in order:

1. **Repository / data** (`packages/db`): scoped by `organizationId`
   where org-owned; no schema change without the `database` agent.
2. **Domain / service** (`packages/*`): pure, explicit, no LLM, bounded.
3. **API** (`apps/worker/src/routes`): zod-validated input, server-side
   authorization, JSON errors that never leak internals.
4. **UI** (`apps/web/src`): semantic HTML, labels, keyboard, visible focus,
   status not by colour alone; React escaping only; truthful plain copy.
5. **Copy and email** (`packages/notifications`, marketing pages): if the
   issue is copy, sweep EVERY surface with grep (pages, components,
   `index.html`, emails, error strings) and report the count changed.

Match the surrounding code's idiom. No unrelated refactors.

## 3. Tests at every touched layer

- Unit tests for pure logic; D1 tests (`*.d1.test.ts`) for repositories
  and worker jobs; route tests for API behaviour; Playwright only where a
  real browser flow is the thing under test.
- Each test must FAIL without the fix. State which test and that you saw
  it red, then green (`pnpm --filter <pkg> test <file>`).
- Never delete, skip or weaken an existing test to get green.

## 4. Docs and ledger

- Update the docs page that describes the behaviour (runbook,
  customer-support, security, data-model) if it changed.
- Add a dated line to `IMPLEMENTATION_LEDGER.md` under the current phase:
  issue, cause, fix, tests, what was NOT done.

## 5. Gates and report

- Run `run-quality-gates` (format, lint, typecheck, tests, build) and
  report the real exit codes.
- Final report, in this order: cause → change per layer (files) → tests
  (names, red→green) → gates (exit codes) → not verified / left out.
