import { z } from 'zod';

/**
 * Typed environment parsing for the names in `.env.example`.
 *
 * Policy:
 * - `APP_ENV` and `APP_BASE_URL` are always required.
 * - Secrets are optional in `local`/`test` (features degrade explicitly) and
 *   REQUIRED in `staging`/`production` — a deploy with a missing secret must
 *   fail at startup, not at first use.
 * - Validation errors list variable NAMES only, never values.
 * - `CLOUDFLARE_ACCOUNT_ID` / `CLOUDFLARE_API_TOKEN` are CI/deployment-only
 *   (per `.env.example`) and deliberately absent from this schema.
 */

export const APP_ENVS = ['local', 'test', 'staging', 'production'] as const;
export type AppEnv = (typeof APP_ENVS)[number];

/** Names that must be present when APP_ENV is staging or production. */
export const DEPLOYED_REQUIRED_NAMES = [
  'BETTER_AUTH_SECRET',
  'BETTER_AUTH_URL',
  'RESEND_API_KEY',
  'EMAIL_FROM',
  'SUPPORT_EMAIL',
  'PADDLE_API_KEY',
  'PADDLE_WEBHOOK_SECRET',
  'PADDLE_CLIENT_TOKEN',
  'PADDLE_ENVIRONMENT',
  'PADDLE_PRICE_FOUNDING_MONTHLY',
  'PADDLE_PRICE_STANDARD_MONTHLY',
  'ADMIN_EMAILS',
  'TED_API_BASE_URL',
] as const;

export const EnvSchema = z.object({
  APP_ENV: z.enum(APP_ENVS),
  APP_BASE_URL: z.url(),
  BETTER_AUTH_SECRET: z.string().min(1).optional(),
  BETTER_AUTH_URL: z.url().optional(),
  RESEND_API_KEY: z.string().min(1).optional(),
  EMAIL_FROM: z.string().min(1).optional(),
  SUPPORT_EMAIL: z.string().min(1).optional(),
  PADDLE_API_KEY: z.string().min(1).optional(),
  PADDLE_WEBHOOK_SECRET: z.string().min(1).optional(),
  PADDLE_CLIENT_TOKEN: z.string().min(1).optional(),
  PADDLE_ENVIRONMENT: z.enum(['sandbox', 'production']).optional(),
  PADDLE_PRICE_FOUNDING_MONTHLY: z.string().min(1).optional(),
  PADDLE_PRICE_STANDARD_MONTHLY: z.string().min(1).optional(),
  ADMIN_EMAILS: z.string().min(1).optional(),
  TED_API_BASE_URL: z.url().optional(),
});

export type AppConfig = z.infer<typeof EnvSchema>;

export class EnvValidationError extends Error {
  readonly missing: readonly string[];
  readonly invalid: readonly string[];

  constructor(missing: readonly string[], invalid: readonly string[]) {
    const parts: string[] = [];
    if (missing.length > 0) {
      parts.push(`missing: ${missing.join(', ')}`);
    }
    if (invalid.length > 0) {
      parts.push(`invalid: ${invalid.join(', ')}`);
    }
    super(`Environment configuration error (names only, values never shown) — ${parts.join('; ')}`);
    this.name = 'EnvValidationError';
    this.missing = missing;
    this.invalid = invalid;
  }
}

/**
 * Parse an environment record (e.g. Worker env bindings or `process.env`)
 * into a typed config. Empty strings are treated as missing. Throws
 * {@link EnvValidationError} aggregating every problem at once; the error
 * carries variable names only.
 */
export function parseEnv(record: Readonly<Record<string, string | undefined>>): AppConfig {
  const present: Record<string, string> = {};
  for (const [name, value] of Object.entries(record)) {
    if (typeof value === 'string' && value.length > 0) {
      present[name] = value;
    }
  }

  const result = EnvSchema.safeParse(present);

  const missing = new Set<string>();
  const invalid = new Set<string>();

  if (!result.success) {
    for (const issue of result.error.issues) {
      const name = typeof issue.path[0] === 'string' ? issue.path[0] : String(issue.path[0]);
      if (present[name] === undefined) {
        missing.add(name);
      } else {
        invalid.add(name);
      }
    }
  }

  const appEnv = present['APP_ENV'];
  if (appEnv === 'staging' || appEnv === 'production') {
    for (const name of DEPLOYED_REQUIRED_NAMES) {
      if (present[name] === undefined) {
        missing.add(name);
      }
    }
  }

  if (!result.success || missing.size > 0 || invalid.size > 0) {
    throw new EnvValidationError([...missing].sort(), [...invalid].sort());
  }

  return result.data;
}
