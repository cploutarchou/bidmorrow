---
description: Check, verify, preview, or flip the pre-launch gate (signups/subscriptions closed until launch). Usage — /launch-mode [status|verify|open|close] [staging|production]
---

Use the `launch-mode` skill (.claude/skills/launch-mode/SKILL.md) as the
procedure of record, then act on the argument:

- **status** (default): curl `/api/public-config` on production AND
  staging; report `prelaunch` + `launchDate` for each with a one-line
  interpretation (closed/open, countdown target).
- **verify**: status, PLUS confirm the gates behave — a `POST
/api/auth/sign-up/email` against the closed environment must return
  403 `signups_closed`; run `pnpm --filter @bidmorrow/worker test` and
  report the prelaunch test results.
- **open** / **close** `[staging|production]`: flip the `prelaunch` flag
  via the internal admin Flags procedure in the skill. PRODUCTION flips
  require an explicit owner instruction in this conversation — never
  infer one. After flipping, re-run **status** and report.

Always report actual command output, never assumed state. If anything is
ambiguous (which environment, whether the owner authorized a production
flip), stop and ask before acting.

$ARGUMENTS
