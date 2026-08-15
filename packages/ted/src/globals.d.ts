/**
 * Minimal ambient declarations for the web-platform globals this package
 * uses. The workspace base tsconfig uses a pure ES lib (no DOM, no
 * @types/node); fetch/URL/setTimeout exist in every target runtime
 * (Cloudflare Workers, Node ≥ 18 for tests). We declare only the surface we
 * touch — if lib-provided types ever arrive in a consumer, delete this file
 * rather than fight it. (`console` is required because the ted typecheck
 * compiles @bidmorrow/observability sources, which log via console.)
 */

declare const console: {
  warn(message: string): void;
  error(message: string): void;
};

declare function setTimeout(callback: () => void, ms?: number): number;

declare class TextEncoder {
  encode(input: string): Uint8Array;
}

interface TedFetchHeaders {
  get(name: string): string | null;
}

interface TedFetchResponse {
  readonly ok: boolean;
  readonly status: number;
  readonly headers: TedFetchHeaders;
  json(): Promise<unknown>;
  text(): Promise<string>;
}

interface TedFetchRequestInit {
  method?: string;
  headers?: Record<string, string>;
  body?: string;
}

declare class URL {
  constructor(url: string, base?: string | URL);
  readonly protocol: string;
  readonly hostname: string;
}

/** `import.meta.url` (ESM standard; used by tests to locate fixtures). */
interface ImportMeta {
  readonly url: string;
}

/**
 * Test-only minimal declarations for the node builtins the contract tests
 * use to load fixtures. Scoped module declarations (not @types/node) so the
 * production surface of this package stays free of Node globals — the
 * client/parser must remain Workers-compatible.
 */
declare module 'node:fs' {
  export function readFileSync(path: string | URL, encoding: 'utf8'): string;
}
