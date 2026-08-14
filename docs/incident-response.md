# Incident Response

Severity classification and response procedure. **Status: Phase 0/1 — this
is the definitive procedure, to be exercised once production exists
[validate: Phase 13].** Operational diagnosis steps live in docs/runbook.md;
this document governs classification, communication, and security incidents.
Solo-operator reality: "incident commander" and "responder" are the same
person; the process still applies — it is what makes 3 a.m. decisions sane.

## Severity levels

| Level | Definition | Examples | Response |
|---|---|---|---|
| SEV1 | Security or data breach; any tenant-isolation failure; data loss | Org A sees Org B's data; leaked secret in use; destructive bug in production | Immediate, drop everything; containment before diagnosis |
| SEV2 | Service down or a core function broken for all users | App unreachable; login broken; no digests sent platform-wide | Within 1 h of detection |
| SEV3 | Degraded | Ingestion stale > 24 h; digest failures for a subset; elevated error rate | Same business day |
| SEV4 | Minor | Cosmetic bugs; single-org glitch with workaround; noisy alert | Next business day; may become a normal ticket |

Tenant-isolation failures are SEV1 **by definition** (security.md), even if
"only one field" leaked or "probably nobody saw it".

## Response steps by level

**SEV1** — 1) Contain first: pause the affected surface (flags, `wrangler
rollback`, or disable the route) — stopping exposure beats diagnosis.
2) Preserve evidence (below). 3) Assess scope. 4) Fix. 5) Notify (below).
6) Post-incident review, mandatory.

**SEV2** — 1) Check the obvious: last deploy (`wrangler rollback` if
correlated), Cloudflare status page, secrets recently rotated. 2) Runbook
diagnosis. 3) Restore service; root cause can wait. 4) Post-incident review,
mandatory.

**SEV3** — Runbook procedure for the failing pipeline; pause flags if the
failure produces bad output (wrong data is worse than no data). Review if
novel.

**SEV4** — Ticket it; batch fixes. No review required.

## Tenant-isolation breach (SEV1 playbook)

1. **Pause the affected surface immediately**: the leaking route/feature via
   flag or Worker rollback; if the vector is digests, `digest_paused = true`;
   if it cannot be isolated, take the app down — availability never
   outranks isolation.
2. **Preserve evidence before changing anything else**: capture a D1 Time
   Travel bookmark (`wrangler d1 time-travel info bidmorrow-prod --env
   production`), export relevant `audit_events` and product-events rows,
   save Worker logs. Do not delete or "clean up" anything.
3. **Assess scope** via audit_events + product events: which orgs' data was
   exposed, to whom, over what time window, via which endpoint. Record the
   query set used — it goes in the review.
4. **Fix** the isolation bug; add a regression test that fails on the old
   code; security-review the fix before deploy.
5. **Notify affected organizations** per legal obligations. The breach-
   notification decision (whether/when/whom/what wording, incl. any
   supervisory-authority duty) **is a human action requiring legal review**
   — see HUMAN_DECISION_BLOCKERS.md item 7. Claude drafts facts and
   timeline; a human decides and sends.
6. Post-incident review; re-run the tenant-isolation test suite; grep-audit
   the repository layer for other missing `organizationId` paths.

## Secret-leak procedure (SEV1)

A secret exposed in logs, a commit, a paste, or a compromised machine:

1. **Rotate immediately** — every leaked secret, no "it was only briefly":
   - Generate/obtain the new value at the provider:
     Stripe Dashboard (roll API key; webhook secret via endpoint settings),
     Resend dashboard (new API key, revoke old), `openssl rand -base64 32`
     for `BETTER_AUTH_SECRET`, Cloudflare dashboard (roll the CI API token).
   - Install it: `wrangler secret put <NAME> --env production` (and
     `--env staging` if that env's secret leaked; they are separate values —
     rotate only what leaked, but verify which env it belonged to).
   - Update the matching GitHub environment secret if CI holds it.
2. **Revoke the old value** at the provider — rotation without revocation
   is theater.
3. **Audit usage during the exposure window**: Stripe Dashboard logs (API
   requests by key), Resend send logs (unexpected sends), Cloudflare audit
   log (API token usage), our audit_events. `BETTER_AUTH_SECRET` leak →
   assume session forgery possible → invalidate all sessions (users
   re-login).
4. If the leak was a git commit: purge from history, force-push per GitHub's
   documented procedure, and treat the secret as permanently public anyway
   (rotation already done in step 1).
5. Post-incident review including *how* it leaked — gitleaks/redaction gap?

## Post-incident review template

File under `docs/incidents/YYYY-MM-DD-<slug>.md` within 5 business days
(SEV1/SEV2 mandatory, SEV3 if novel):

```markdown
# Incident: <title>
- Severity / Detected / Resolved / Duration:
- Customer impact: (orgs affected, data exposed?, downtime)
## Timeline (UTC)
- HH:MM event …
## Root cause
(the actual mechanism, not "human error")
## What went well / what went badly
## Action items
- [ ] fix + regression test (owner, due date)
- [ ] detection gap: would the health page have caught this earlier?
- [ ] doc/runbook update
```

Reviews are blameless and concrete: every SEV1/SEV2 must produce at least
one prevention or detection action item, tracked to completion.
