/**
 * Post-login/verify routing (onboarding-overhaul M1, fix for ux-strategy.md
 * F12/§1.3 R1: today every newly authenticated user is sent straight to
 * `/app`, where an org-less account 403s with no link — "the single worst
 * moment in the product today"). Client-side navigation ONLY — the server
 * independently enforces every route/API call; nothing here is a security
 * boundary (docs/conventions/frontend.md "never embed role/organization logic
 * client-side as a security mechanism").
 */
import { api, ApiError } from './api';
import type { OrgProfileResponse } from './onboarding-types';

/**
 * `returnTo` must be a same-origin path starting with a single `/` — never
 * a full URL, a protocol-relative `//host/...`, or a backslash variant a
 * browser might still treat as protocol-relative. Open-redirect guard for
 * R4 (`/login?returnTo=...`, e.g. from expired-session digest links).
 */
export function isSafeReturnTo(value: string | null | undefined): value is string {
  if (value === null || value === undefined || value.length === 0) return false;
  if (!value.startsWith('/')) return false;
  if (value.startsWith('//')) return false;
  if (value.startsWith('/\\')) return false;
  return true;
}

/**
 * Resolves where a freshly authenticated session should land (R1): a
 * validated `returnTo` wins; otherwise probe `GET /api/org/profile` (the
 * same existing, unchanged endpoint) and route by onboarding completion —
 * no organization yet, or an organization whose profile has never been
 * marked complete, both go to `/onboarding`; a fully onboarded org goes to
 * `/app`.
 */
export async function resolvePostAuthDestination(
  returnTo: string | null | undefined,
): Promise<string> {
  if (isSafeReturnTo(returnTo)) return returnTo;
  try {
    const res = await api.get<OrgProfileResponse>('/api/org/profile');
    if (res.profile === null || res.profile.onboardingCompletedAt === null) {
      return '/onboarding';
    }
    return '/app';
  } catch (cause) {
    // 403 = no organization at all yet (`requireOrganization`) — that's
    // still an "incomplete profile", not a failure to route around.
    if (cause instanceof ApiError && cause.status === 403) return '/onboarding';
    // Any other failure (network blip, 5xx): fail toward the feed rather
    // than trapping a user who might already be fully set up — the feed's
    // own 403/402 states remain the backstop either way.
    return '/app';
  }
}
