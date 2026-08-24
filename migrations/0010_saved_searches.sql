-- 0010_saved_searches — named, reusable feed filter sets, per organization.
--
-- Purpose: the feed's filter bar is transient. An operator who narrows to
-- "SOC work in CY and GR closing this month" loses that the moment they
-- switch tabs or reload, so the same filters get retyped every morning.
-- `saved_searches` makes a filter set a durable, named object the feed's
-- left rail can list and re-apply.
--
-- ORGANIZATION-OWNED (docs/security.md C6): `organization_id` is NOT NULL,
-- foreign-keyed and indexed, and every repository function that reads or
-- writes this table REQUIRES an organizationId. A saved search is shared by
-- the whole organization on purpose — it is a team's view of the market,
-- not a personal bookmark — so `created_by_user_id` records authorship for
-- the audit trail without scoping visibility.
--
-- `created_by_user_id` is nullable and ON DELETE-free by convention with
-- 0005_nullable_authorship: removing a user must not cascade away the
-- team's saved searches, and must not leave a dangling FK either, so the
-- column is set to NULL by the account-deletion path.
--
-- `filters_json` stores the feed query as JSON rather than as columns: it
-- is a client-side view specification, matched 1:1 to the feed's own filter
-- shape (apps/web/src/pages/app/Feed.tsx), and it will grow whenever a new
-- filter is added. Columns would mean a migration per filter for data the
-- server never queries BY — it only reads the blob back out and hands it to
-- the client. The API validates the shape on write, so the blob is never
-- free-form user input.
--
-- Unique on (organization_id, name): two saved searches with the same name
-- in one workspace are indistinguishable in the rail. Added at creation
-- time — SQLite cannot add a unique constraint later without a table
-- rebuild.
--
-- No data is dropped or retyped by this migration; it creates one new table.

-- Column notes, kept OUTSIDE the statement as `--` comments on purpose:
-- wrangler's --remote path splits statements before sending them to the
-- D1 HTTP API, and its splitter mishandles /* */ block comments inside a
-- statement — the API receives a truncated fragment and fails with
-- SQLITE_ERROR "incomplete input" [7500]. This file was the repo's first
-- migration to use block comments and the first to fail on staging
-- (2026-08-24); the local apply path parses them fine, which is why CI's
-- from-empty chain apply never caught it.
--   tab          — feed tab the search applies to: today | strong |
--                  worth_reviewing | possible | saved | ignored.
--   filters_json — JSON object of the feed filter fields; validated by
--                  the API on write.
CREATE TABLE saved_searches (
  id TEXT PRIMARY KEY,
  organization_id TEXT NOT NULL REFERENCES organizations(id),
  created_by_user_id TEXT REFERENCES users(id),
  name TEXT NOT NULL,
  tab TEXT NOT NULL,
  filters_json TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);

CREATE UNIQUE INDEX uq_saved_searches__organization_id_name
  ON saved_searches (organization_id, name);

CREATE INDEX idx_saved_searches__organization_id
  ON saved_searches (organization_id);
