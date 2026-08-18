# Test layout

Map of the test layers, mirroring `docs/architecture.md`. Phase 2 establishes
the first two layers; the `tests/*` suites arrive in Phases 5-12.

| Layer                 | Location                                                   | Runner                                                                                                                    | Status                               |
| --------------------- | ---------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------- | ------------------------------------ |
| Unit (packages + web) | `packages/*/src/**/*.test.ts`, `apps/web/src/**/*.test.ts` | root `vitest.config.ts`, plain node environment                                                                           | Phase 2                              |
| Worker integration    | `apps/worker/src/**/*.test.ts`                             | `apps/worker/vitest.config.ts` via `@cloudflare/vitest-pool-workers` (workerd, real bindings, per-file storage isolation) | Phase 2                              |
| Fixtures              | `tests/fixtures/`                                          | shared data (sanitized real TED notices etc.), not a suite                                                                | Phase 5+ (`ted-fixture-refresh`)     |
| Contract              | `tests/contract/`                                          | Vitest — parser vs. real eForms fixtures                                                                                  | Phase 5                              |
| Integration           | `tests/integration/`                                       | Vitest — cross-module flows against local bindings                                                                        | Phases 6-9                           |
| Security              | `tests/security/`                                          | Vitest — authz/tenant-isolation regression suites                                                                         | Phases 6-11                          |
| End-to-end            | `tests/e2e/`                                               | Playwright (root `playwright.config.ts`)                                                                                  | Phase 12 (see `tests/e2e/README.md`) |

## How tests run

- `pnpm test` (root) runs the root Vitest projects **and then** the worker's
  own suite: `vitest run && pnpm --filter @bidmorrow/worker test`. The worker
  is excluded from the root config because its tests must execute inside
  workerd, not node.
- CI (`.github/workflows/ci.yml`) runs `pnpm test` as one step; Playwright is
  deliberately **not** in CI until Phase 12.

## Conventions

- Unit tests are colocated next to the code they test (`src/foo.test.ts`) and
  must be meaningful — no placeholder asserts.
- Worker-runtime tests (anything needing D1/R2/Queues bindings) live only in
  `apps/worker`.
- Directories listed as Phase 5+ are created in their phase — do not add
  empty scaffolding for them now.
