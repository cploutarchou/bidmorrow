---
name: verify-current-docs
description: Verify an API surface, config syntax, or platform limit against CURRENT official documentation before implementing against it. Use before adopting any external API call, wrangler/Stripe/Better Auth/TED syntax, or quoting a platform limit in docs or the cost model.
---

# Verify current docs

Never trust model memory for API syntax, limits, or pricing. Blog tutorials
do not count when authoritative docs exist.

## Procedure

1. Identify the authoritative source:
   - Cloudflare → developers.cloudflare.com (or the Cloudflare docs MCP search tool)
   - TED / eForms → docs.ted.europa.eu, github.com/OP-TED (eForms SDK)
   - CPV/NUTS → EU Publications Office / Eurostat (ec.europa.eu, op.europa.eu)
   - Stripe → docs.stripe.com
   - Better Auth → better-auth.com/docs
   - Hono → hono.dev · Drizzle → orm.drizzle.team · Resend → resend.com/docs
   - Vitest/Playwright/Vite/React → their official docs sites
   - Claude Code → code.claude.com/docs
   - Package versions → the npm registry (`npm view <pkg> version`)
2. WebFetch the specific doc page (WebSearch only to locate it). Confirm the
   exact syntax/limit/price you are about to rely on.
3. Record what you verified in docs/dependency-versions.md (or the relevant
   doc): fact, source URL, date checked.
4. If official docs contradict an existing ADR or doc in this repo, do not
   silently diverge — flag it to the architect for a superseding ADR.
5. If a fact cannot be verified from an official source, say so explicitly
   and treat it as unverified — never present it as confirmed.
