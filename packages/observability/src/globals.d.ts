/**
 * Minimal ambient declaration of the console surface the logger uses.
 *
 * The workspace base tsconfig uses a pure ES lib (no DOM, no @types/node),
 * but `console.warn`/`console.error` exist in every target runtime (Cloudflare
 * Workers, Node for tests). Declaring only what we use keeps the package free
 * of runtime-specific type dependencies. If a global console type ever arrives
 * via lib/types in a consumer, this file should be deleted rather than fought.
 */
declare const console: {
  warn(message: string): void;
  error(message: string): void;
};
