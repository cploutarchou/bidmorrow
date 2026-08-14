/**
 * Drizzle schema barrel — every table in the Phase 3 core schema
 * (docs/data-model.md), grouped by schema area. `auth_accounts` and
 * `auth_sessions` are deliberately absent: Better Auth generates them in
 * Phase 4 (see the AUTH TABLES DECISION comment in ./identity).
 */
export { users, organizations, organizationMembers } from './identity';
export {
  companyProfiles,
  companyCapabilities,
  companyCertifications,
  companyCpvPreferences,
  companyGeographies,
  companyKeywords,
  companyExclusions,
  matchingPreferences,
  digestPreferences,
} from './company';
export {
  buyers,
  tenderNotices,
  tenderNoticeVersions,
  tenderLots,
  tenderCpvCodes,
  tenderGeographies,
  exchangeRates,
} from './tender';
export {
  ingestionRuns,
  ingestionCheckpoints,
  ingestionErrors,
  sourceSnapshots,
} from './ingestion';
export { tenderMatches, matchComponents, matchRiskFlags } from './matching';
export {
  savedTenders,
  ignoredTenders,
  customerFeedback,
  digestRuns,
  digestItems,
  emailDeliveries,
} from './engagement';
export { subscriptions, billingEvents } from './billing';
export { productEvents, auditEvents, supportNotes, featureFlags } from './ops';
