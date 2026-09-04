# Claude Design handoff bundle, 2026-08-21

The design source the 2026-08-21 website and interface rebuild was
implemented from (`IMPLEMENTATION_LEDGER.md`, "FULL 2026-08-21
design-handoff implementation"). The owner exported it from Claude Design
as `Bidmorrow repository connection-handoff.zip` and pushed it to the
`upload-template` branch; `main` git-ignores the zip itself. This folder
is the same bundle unpacked, preserved here on 2026-09-04 so the branch
could be deleted without losing the only copy in the repository.

- `HANDOFF-README.md` is the bundle's own read-me, written for a coding
  agent at export time; its instructions are historical, not current.
- `project/*.dc.html` are the eight prototypes (Homepage, Marketing, Auth,
  Onboarding, Client Area, Admin, Theme Spec, Type Options).
- `project/_ds/` are the design-system bundles the prototypes import;
  `project/uploads/` are images pasted into the canvas; `project/github.md`
  is the export's sync note against this repository.

Prototypes, not product code: excluded from prettier and eslint. Never
imported by the application.
