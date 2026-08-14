/**
 * Drizzle schema barrel — every table in the schema (docs/data-model.md),
 * grouped by schema area. `users`, `auth_accounts`, `auth_sessions`,
 * `auth_verifications`, `auth_rate_limits` are Better Auth core tables,
 * hand-mapped in Phase 4 (see the AUTH TABLES DECISION comment in
 * ./identity).
 */
export {
  users,
  authAccounts,
  authSessions,
  authVerifications,
  authRateLimits,
  organizations,
  organizationMembers,
} from './identity';
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
export { ingestionRuns, ingestionCheckpoints, ingestionErrors, sourceSnapshots } from './ingestion';
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
