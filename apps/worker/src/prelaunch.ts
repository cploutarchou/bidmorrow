/**
 * Pre-launch gate (owner decision 2026-08-21): production keeps
 * registrations and NEW subscriptions closed until the end-of-August
 * launch, while staging/local keep full flows for testing and E2E.
 *
 * State is flag-driven (`prelaunch`, `launch_date` — admin-editable via
 * the existing Flags section with the UPDATE_FLAG typed confirmation) with
 * an ENVIRONMENT-AWARE default when the flag is absent: closed on
 * `APP_ENV === 'production'`, open everywhere else. Go-live is therefore a
 * single admin flag flip (`prelaunch` → `"false"`), no deploy.
 *
 * Log-in, password reset, verification and every existing-account flow
 * stay open throughout — only NEW account creation and NEW checkout
 * sessions are gated (see index.ts and routes/billing.ts call sites).
 */
import { DEFAULT_LAUNCH_DATE, FLAG_LAUNCH_DATE, FLAG_PRELAUNCH } from '@bidmorrow/config';
import { getFeatureFlag, type Db } from '@bidmorrow/db';

export interface PrelaunchState {
  /** True while registrations + new subscriptions are closed. */
  readonly prelaunch: boolean;
  /** ISO-8601 instant the public countdown counts down to. */
  readonly launchDate: string;
}

/**
 * Pure resolver — separated from the DB read so the default/validation
 * logic is unit-testable without a database. Malformed stored values fall
 * back to the same defaults as an absent flag (setFeatureFlag rejects
 * invalid JSON at write time, so this is belt-and-braces).
 */
export function resolvePrelaunchState(
  prelaunchValueJson: string | null,
  launchDateValueJson: string | null,
  appEnv: string,
): PrelaunchState {
  let prelaunch = appEnv === 'production';
  if (prelaunchValueJson !== null) {
    try {
      const parsed: unknown = JSON.parse(prelaunchValueJson);
      if (typeof parsed === 'boolean') prelaunch = parsed;
    } catch {
      // keep the environment default
    }
  }
  let launchDate = DEFAULT_LAUNCH_DATE;
  if (launchDateValueJson !== null) {
    try {
      const parsed: unknown = JSON.parse(launchDateValueJson);
      if (typeof parsed === 'string' && !Number.isNaN(Date.parse(parsed))) {
        launchDate = parsed;
      }
    } catch {
      // keep the default launch date
    }
  }
  return { prelaunch, launchDate };
}

/** Reads both flags and resolves the effective pre-launch state. */
export async function readPrelaunchState(db: Db, appEnv: string): Promise<PrelaunchState> {
  const [prelaunchFlag, launchDateFlag] = await Promise.all([
    getFeatureFlag(db, FLAG_PRELAUNCH),
    getFeatureFlag(db, FLAG_LAUNCH_DATE),
  ]);
  return resolvePrelaunchState(
    prelaunchFlag?.valueJson ?? null,
    launchDateFlag?.valueJson ?? null,
    appEnv,
  );
}
