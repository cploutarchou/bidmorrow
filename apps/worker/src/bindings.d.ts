/**
 * Global type wiring for @cloudflare/workers-types v5.
 *
 * - `Cloudflare.Env` types `env` from `cloudflare:workers` (used directly in
 *   tests); kept in sync with the exported `Env` interface in src/index.ts,
 *   which mirrors wrangler.jsonc.
 * - `Cloudflare.GlobalProps.mainModule` types `exports` / `ctx.exports`;
 *   integration tests rely on it for `exports.default.fetch()`.
 *
 * If we later adopt `wrangler types` codegen (worker-configuration.d.ts),
 * this hand-written file is replaced by the generated one.
 */
type WorkerEnv = import('./index').Env;

declare namespace Cloudflare {
  interface Env extends WorkerEnv {}
  interface GlobalProps {
    mainModule: typeof import('./index');
  }
}
