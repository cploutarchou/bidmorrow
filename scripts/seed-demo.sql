-- ============================================================================
-- BidMorrow DEMO SEED DATA — LOCAL DEVELOPMENT ONLY. NEVER RUN IN PRODUCTION.
-- ============================================================================
-- This file inserts a fake demo organization, demo user, demo company profile
-- and two fake tender notices so the local feed has data during development.
-- Every org/user row here is a demo row: ids are fixed and prefixed 'demo_'
-- (org id 'org_demo_acme'), the user email is on the reserved .example TLD,
-- and the notices use clearly fake source ids TED-DEMO-001 / TED-DEMO-002
-- with example.invalid source URLs. None of this data comes from TED.
--
-- Apply ONLY manually, ONLY against the local D1 database, from apps/worker:
--   npx wrangler d1 execute bidmorrow --local --file <abs-path>/scripts/seed-demo.sql
-- (see scripts/README.md). It is NOT part of migrations, NOT applied by any
-- automated process, and MUST NOT be executed with --remote or against
-- staging/production databases.
--
-- Requires migrations 0001_init + 0002_core_schema to be applied first.
-- All statements are INSERT OR IGNORE with fixed ids, so re-running is a
-- no-op (idempotent). Timestamps are fixed epoch-millis (UTC):
--   1786665600000 = 2026-08-14T00:00:00Z  (seed authoring date)
--   1789473600000 = 2026-09-15T12:00:00Z  (demo deadline, notice 1)
--   1790848800000 = 2026-10-01T10:00:00Z  (demo deadline, notice 2)
-- ============================================================================

-- ---------------------------------------------------------------------------
-- 1. Demo user (placeholder users table; Better Auth reconciles in Phase 4)
-- ---------------------------------------------------------------------------
INSERT OR IGNORE INTO users (id, email, email_verified, name, created_at, updated_at)
VALUES ('demo_user_acme_owner_0001', 'demo@acme-cyber.example', 1,
        'Demo Owner (Acme Cyber Consulting)', 1786665600000, 1786665600000);

-- ---------------------------------------------------------------------------
-- 2. Demo organization + membership
-- ---------------------------------------------------------------------------
INSERT OR IGNORE INTO organizations (id, name, status, created_by_user_id, created_at, updated_at)
VALUES ('org_demo_acme', 'Acme Cyber Consulting', 'active',
        'demo_user_acme_owner_0001', 1786665600000, 1786665600000);

INSERT OR IGNORE INTO organization_members (id, organization_id, user_id, role, created_at, updated_at)
VALUES ('demo_member_acme_owner_0001', 'org_demo_acme', 'demo_user_acme_owner_0001',
        'ORGANIZATION_OWNER', 1786665600000, 1786665600000);

-- ---------------------------------------------------------------------------
-- 3. Company profile & preferences (cyber_consultancy preset)
-- ---------------------------------------------------------------------------
INSERT OR IGNORE INTO company_profiles
  (id, organization_id, display_name, description, website, employee_band,
   preset_key, onboarding_completed_at, created_at, updated_at)
VALUES ('demo_profile_acme_00000001', 'org_demo_acme', 'Acme Cyber Consulting',
        'Demo cybersecurity consultancy: penetration testing, security assessments and SOC consulting for the public sector.',
        'https://acme-cyber.example', '11-25', 'cyber_consultancy',
        1786665600000, 1786665600000, 1786665600000);

-- Capabilities (labels normalized lower-case per data-model.md)
INSERT OR IGNORE INTO company_capabilities (id, organization_id, label, created_at, updated_at) VALUES
  ('demo_cap_cloud_security_01', 'org_demo_acme', 'cloud security', 1786665600000, 1786665600000),
  ('demo_cap_pentesting_000001', 'org_demo_acme', 'penetration testing', 1786665600000, 1786665600000),
  ('demo_cap_sec_assessment_01', 'org_demo_acme', 'security assessments', 1786665600000, 1786665600000),
  ('demo_cap_soc_consulting_01', 'org_demo_acme', 'soc consulting', 1786665600000, 1786665600000);

-- Certifications
INSERT OR IGNORE INTO company_certifications
  (id, organization_id, certification_code, label, created_at, updated_at)
VALUES ('demo_cert_iso27001_000001', 'org_demo_acme', 'ISO_27001', NULL,
        1786665600000, 1786665600000);

-- CPV preferences (8-digit, check digit stripped)
INSERT OR IGNORE INTO company_cpv_preferences (id, organization_id, cpv_code, created_at, updated_at) VALUES
  ('demo_cpvpref_72150000_0001', 'org_demo_acme', '72150000', 1786665600000, 1786665600000),
  ('demo_cpvpref_72200000_0001', 'org_demo_acme', '72200000', 1786665600000, 1786665600000),
  ('demo_cpvpref_79417000_0001', 'org_demo_acme', '79417000', 1786665600000, 1786665600000);

-- Geographies
INSERT OR IGNORE INTO company_geographies (id, organization_id, kind, code, created_at, updated_at) VALUES
  ('demo_geo_opp_country_cy_01', 'org_demo_acme', 'opportunity_country', 'CY', 1786665600000, 1786665600000),
  ('demo_geo_served_cy_000001',  'org_demo_acme', 'country_served',      'CY', 1786665600000, 1786665600000),
  ('demo_geo_pref_nuts_cy00_01', 'org_demo_acme', 'preferred_nuts',      'CY00', 1786665600000, 1786665600000);

-- Keywords: positives (synonym_group NULL) + one synonym group 'soc'
INSERT OR IGNORE INTO company_keywords
  (id, organization_id, kind, term, synonym_group, language, created_at, updated_at) VALUES
  ('demo_kw_pos_pentest_00001', 'org_demo_acme', 'positive', 'penetration testing', NULL, 'en', 1786665600000, 1786665600000),
  ('demo_kw_pos_secassess_001', 'org_demo_acme', 'positive', 'security assessment', NULL, 'en', 1786665600000, 1786665600000),
  ('demo_kw_pos_soc_00000001',  'org_demo_acme', 'positive', 'soc',                 NULL, 'en', 1786665600000, 1786665600000),
  ('demo_kw_syn_soc_centre_01', 'org_demo_acme', 'synonym', 'security operations centre', 'soc', 'en', 1786665600000, 1786665600000),
  ('demo_kw_syn_soc_center_01', 'org_demo_acme', 'synonym', 'security operations center', 'soc', 'en', 1786665600000, 1786665600000);

-- Exclusions (hard-exclusion inputs)
INSERT OR IGNORE INTO company_exclusions (id, organization_id, kind, value, created_at, updated_at)
VALUES ('demo_excl_phrase_hw_00001', 'org_demo_acme', 'phrase', 'hardware supply',
        1786665600000, 1786665600000);

-- Matching preferences (doc defaults: null bounds, null deadline threshold)
INSERT OR IGNORE INTO matching_preferences
  (id, organization_id, min_value_eur, max_value_eur, supported_contract_natures_json,
   minimum_days_remaining, created_at, updated_at)
VALUES ('demo_matchpref_acme_00001', 'org_demo_acme', NULL, NULL, '["services"]',
        NULL, 1786665600000, 1786665600000);

-- Digest preferences (doc defaults; org is Cyprus-based)
INSERT OR IGNORE INTO digest_preferences
  (id, organization_id, enabled, send_empty, min_classification, timezone, created_at, updated_at)
VALUES ('demo_digestpref_acme_0001', 'org_demo_acme', 1, 0, 'WORTH_REVIEWING',
        'Asia/Nicosia', 1786665600000, 1786665600000);

-- ---------------------------------------------------------------------------
-- 4. Demo buyers (global table; ids marked demo, names marked Demo)
-- ---------------------------------------------------------------------------
INSERT OR IGNORE INTO buyers
  (id, source, source_buyer_id, name, country_code, buyer_legal_type, buyer_activity, created_at, updated_at) VALUES
  ('demo_buyer_cy_ministry_01', 'ted', 'ORG-DEMO-0001', 'Demo Ministry of Digital Policy (CY)', 'CY', 'cga', 'gen-pub', 1786665600000, 1786665600000),
  ('demo_buyer_de_agency_0001', 'ted', 'ORG-DEMO-0002', 'Demo Federal IT Agency (DE)',          'DE', 'cga', 'gen-pub', 1786665600000, 1786665600000);

-- ---------------------------------------------------------------------------
-- 5. Demo source snapshots (fake R2 keys under demo/; nothing exists in R2)
-- ---------------------------------------------------------------------------
INSERT OR IGNORE INTO source_snapshots
  (id, source, source_notice_id, version_number, r2_key, content_hash, size_bytes,
   content_type, retained_until_at, deleted_at, created_at, updated_at) VALUES
  ('demo_snap_ted_demo_001_v1', 'ted', 'TED-DEMO-001', 1, 'demo/ted/TED-DEMO-001/v1.xml',
   'demo-hash-ted-demo-001-v1', 2048, 'application/xml', NULL, NULL, 1786665600000, 1786665600000),
  ('demo_snap_ted_demo_002_v1', 'ted', 'TED-DEMO-002', 1, 'demo/ted/TED-DEMO-002/v1.xml',
   'demo-hash-ted-demo-002-v1', 4096, 'application/xml', NULL, NULL, 1786665600000, 1786665600000);

-- ---------------------------------------------------------------------------
-- 6. Demo tender notices (competition), versions, lots, CPV, geographies
--    current_version_id is set by UPDATE after the version rows exist, so
--    the file applies cleanly with foreign keys enforced and stays idempotent.
-- ---------------------------------------------------------------------------
INSERT OR IGNORE INTO tender_notices
  (id, source, source_notice_id, current_version_id, buyer_id, notice_type,
   procedure_type, eforms_sdk_version, source_languages_json, source_url,
   publication_date, retrieved_at, content_hash, archived_at, created_at, updated_at) VALUES
  ('demo_notice_ted_demo_0001', 'ted', 'TED-DEMO-001', NULL, 'demo_buyer_cy_ministry_01',
   '16', 'open', 'eforms-sdk-1.10', '["ENG"]',
   'https://example.invalid/ted/notice/TED-DEMO-001',
   '2026-08-10', 1786665600000, 'demo-hash-ted-demo-001-v1', NULL, 1786665600000, 1786665600000),
  ('demo_notice_ted_demo_0002', 'ted', 'TED-DEMO-002', NULL, 'demo_buyer_de_agency_0001',
   '16', 'open', 'eforms-sdk-1.10', '["ENG","DEU"]',
   'https://example.invalid/ted/notice/TED-DEMO-002',
   '2026-08-12', 1786665600000, 'demo-hash-ted-demo-002-v1', NULL, 1786665600000, 1786665600000);

INSERT OR IGNORE INTO tender_notice_versions
  (id, notice_id, version_number, publication_date, content_hash, snapshot_id,
   eforms_sdk_version, ingestion_run_id, created_at) VALUES
  ('demo_ver_ted_demo_001_v01', 'demo_notice_ted_demo_0001', 1, '2026-08-10',
   'demo-hash-ted-demo-001-v1', 'demo_snap_ted_demo_001_v1', 'eforms-sdk-1.10', NULL, 1786665600000),
  ('demo_ver_ted_demo_002_v01', 'demo_notice_ted_demo_0002', 1, '2026-08-12',
   'demo-hash-ted-demo-002-v1', 'demo_snap_ted_demo_002_v1', 'eforms-sdk-1.10', NULL, 1786665600000);

-- Repoint current_version_id (idempotent: only fills a NULL pointer)
UPDATE tender_notices SET current_version_id = 'demo_ver_ted_demo_001_v01'
  WHERE id = 'demo_notice_ted_demo_0001' AND current_version_id IS NULL;
UPDATE tender_notices SET current_version_id = 'demo_ver_ted_demo_002_v01'
  WHERE id = 'demo_notice_ted_demo_0002' AND current_version_id IS NULL;

-- Notice 1: single lot, published value, deadline 2026-09-15T12:00:00Z
INSERT OR IGNORE INTO tender_lots
  (id, notice_version_id, lot_number, title, description, contract_nature,
   estimated_value_amount, estimated_value_currency, estimated_value_eur,
   value_is_derived, deadline_at, created_at) VALUES
  ('demo_lot_ted_demo_001_l01', 'demo_ver_ted_demo_001_v01', 'LOT-0001',
   'Penetration testing and security assessment services',
   'Demo lot: annual penetration testing and security assessments of government e-services (fake data).',
   'services', 180000, 'EUR', 180000, 0, 1789473600000, 1786665600000);

-- Notice 2: two lots, procedure total split across lots (value_is_derived 1),
-- deadline 2026-10-01T10:00:00Z
INSERT OR IGNORE INTO tender_lots
  (id, notice_version_id, lot_number, title, description, contract_nature,
   estimated_value_amount, estimated_value_currency, estimated_value_eur,
   value_is_derived, deadline_at, created_at) VALUES
  ('demo_lot_ted_demo_002_l01', 'demo_ver_ted_demo_002_v01', 'LOT-0001',
   'Security monitoring software licences',
   'Demo lot: supply of security monitoring software packages (fake data).',
   'supplies', 250000, 'EUR', 250000, 1, 1790848800000, 1786665600000),
  ('demo_lot_ted_demo_002_l02', 'demo_ver_ted_demo_002_v01', 'LOT-0002',
   'Security operations centre consulting',
   'Demo lot: consulting services for the build-out of a federal security operations centre (fake data).',
   'services', 150000, 'EUR', 150000, 1, 1790848800000, 1786665600000);

INSERT OR IGNORE INTO tender_cpv_codes (id, lot_id, cpv_code, is_main, created_at) VALUES
  ('demo_cpv_d001_l01_main_01', 'demo_lot_ted_demo_001_l01', '72150000', 1, 1786665600000),
  ('demo_cpv_d002_l01_main_01', 'demo_lot_ted_demo_002_l01', '48000000', 1, 1786665600000),
  ('demo_cpv_d002_l02_main_01', 'demo_lot_ted_demo_002_l02', '72150000', 1, 1786665600000),
  ('demo_cpv_d002_l02_addl_01', 'demo_lot_ted_demo_002_l02', '72200000', 0, 1786665600000);

INSERT OR IGNORE INTO tender_geographies (id, lot_id, country_code, nuts_code, created_at) VALUES
  ('demo_tgeo_d001_l01_cy_001', 'demo_lot_ted_demo_001_l01', 'CY', 'CY000', 1786665600000),
  ('demo_tgeo_d002_l01_de_001', 'demo_lot_ted_demo_002_l01', 'DE', 'DE300', 1786665600000),
  ('demo_tgeo_d002_l02_de_001', 'demo_lot_ted_demo_002_l02', 'DE', 'DE300', 1786665600000),
  ('demo_tgeo_d002_l02_cy_001', 'demo_lot_ted_demo_002_l02', 'CY', NULL, 1786665600000);
