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

CREATE TABLE saved_searches (
  id TEXT PRIMARY KEY,
  organization_id TEXT NOT NULL REFERENCES organizations(id),
  created_by_user_id TEXT REFERENCES users(id),
  name TEXT NOT NULL,
  /* Feed tab the search applies to: today | strong | worth_reviewing |
     possible | saved | ignored. */
  tab TEXT NOT NULL,
  /* JSON object of the feed filter fields; validated by the API on write. */
  filters_json TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);

CREATE UNIQUE INDEX uq_saved_searches__organization_id_name
  ON saved_searches (organization_id, name);

CREATE INDEX idx_saved_searches__organization_id
  ON saved_searches (organization_id);
