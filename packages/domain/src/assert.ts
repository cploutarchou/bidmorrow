/**
 * Exhaustiveness helper: call in the `default`/final branch of a switch or
 * if-chain over a literal union. If a union member is unhandled, the argument
 * is not `never` and the compiler rejects the call; at runtime an unexpected
 * value (e.g. from the database) throws instead of passing silently.
 */
export function assertNever(value: never, message?: string): never {
  throw new Error(message ?? `assertNever received an unexpected value: ${String(value)}`);
}
