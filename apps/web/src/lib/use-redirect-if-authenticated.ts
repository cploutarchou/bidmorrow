import { useEffect, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router';
import { useAuth } from './auth-context';
import { resolvePostAuthDestination } from './post-auth-route';

/**
 * Shared guard for `/login` and `/signup`: an already-authenticated visitor
 * must never be asked to sign in/up again, so redirect (replace) to
 * `resolvePostAuthDestination`, the same routing used right after a fresh
 * sign-in (Login.tsx), so an authenticated visit lands wherever that
 * account's state says it should (an explicit `?returnTo=`, else
 * `/onboarding` vs `/app` by profile completeness).
 *
 * Callers must render the SAME minimal loading state `ProtectedRoute` uses
 * (`<main id="main-content"><p>Loading…</p></main>`) whenever `ready` is
 * false, never the sign-in/sign-up form, so there is no flash of a form
 * a session-holding visitor is about to be redirected away from. `ready`
 * covers both the initial session check (`loading`) and the follow-up
 * destination probe for an authenticated visitor (`redirecting`).
 *
 * Deliberately does NOT special-case an authenticated-but-unverified user:
 * Better Auth (packages/auth, `requireEmailVerification: true`) never
 * creates a session for an unverified email in this app: sign-up skips
 * auto-sign-in when verification is required, and sign-in itself 403s an
 * unverified email (`EMAIL_NOT_VERIFIED`, handled inline in Login.tsx)
 * before any session exists. So `user !== null` here always means
 * "already verified and signed in"; the post-signup "check your inbox"
 * page (`/verify-email`) is reached with no session at all and is
 * unaffected by this hook.
 */
export function useRedirectIfAuthenticated(): { ready: boolean } {
  const { user, loading } = useAuth();
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();
  const [redirecting, setRedirecting] = useState(false);

  useEffect(() => {
    if (loading || user === null) return;
    setRedirecting(true);
    let cancelled = false;
    void resolvePostAuthDestination(searchParams.get('returnTo')).then((destination) => {
      if (!cancelled) navigate(destination, { replace: true });
    });
    return () => {
      cancelled = true;
    };
  }, [loading, user, searchParams, navigate]);

  return { ready: !loading && user === null && !redirecting };
}
