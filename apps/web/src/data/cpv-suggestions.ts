/**
 * Curated CPV code suggestions for the client-side CPV autocomplete.
 *
 * Source: official CPV 2008 codelist (Regulation (EC) No 213/2008). English
 * labels are taken verbatim from the Publications Office `cpv` genericode
 * codelist (`cpv_2008_core`, canonical URI
 * http://publications.europa.eu/resource/dataset/cpv) as distributed in the
 * OP-TED eForms SDK (`codelists/cpv.gc`). Every label below was extracted
 * from that authoritative file on 2026-08-18; none are recalled from memory
 * or paraphrased.
 *
 * Scope decision (deliberately not the full 9,454-code vocabulary): the
 * codes most relevant to BidMorrow's ICP (EU IT/cyber/software
 * consultancies, docs/product-scope.md) and the V1 ingestion scope
 * (docs/ted-ingestion-scope.md):
 * - all of divisions 48 (software packages) and 72 (IT services) at
 *   division/group/class level, plus ICP-relevant 72* category-level codes
 *   (consultancy, development, testing, support);
 * - the relevant 79 (business/management consultancy, incl. 79417000 safety
 *   consultancy), 80 (training), 64 (telecommunications services) and 32
 *   (network/telecom equipment) families at division/group/class level;
 * - every CPV code referenced by packages/domain/src/presets.ts and
 *   scripts/seed-demo.sql.
 *
 * Codes are stored as 8-digit strings without the check-digit suffix,
 * matching packages/domain/src/presets.ts. These are suggestions only: the
 * user can still enter any valid CPV code; this list never constrains
 * matching or ingestion scope (which is config-driven, see
 * docs/ted-ingestion-scope.md).
 */

export interface CpvSuggestion {
  readonly code: string;
  readonly label: string;
}

export const CPV_SUGGESTIONS: readonly CpvSuggestion[] = [
  {
    code: '32000000',
    label: 'Radio, television, communication, telecommunication and related equipment',
  },
  { code: '32400000', label: 'Networks' },
  { code: '32410000', label: 'Local area network' },
  { code: '32420000', label: 'Network equipment' },
  { code: '32500000', label: 'Telecommunications equipment and supplies' },
  { code: '32520000', label: 'Telecommunications cable and equipment' },
  { code: '32580000', label: 'Data equipment' },
  { code: '48000000', label: 'Software package and information systems' },
  { code: '48100000', label: 'Industry specific software package' },
  { code: '48110000', label: 'Point of sale (POS) software package' },
  { code: '48120000', label: 'Flight control software package' },
  { code: '48130000', label: 'Aviation ground support and test software package' },
  { code: '48140000', label: 'Railway traffic control software package' },
  { code: '48150000', label: 'Industrial control software package' },
  { code: '48160000', label: 'Library software package' },
  { code: '48170000', label: 'Compliance software package' },
  { code: '48180000', label: 'Medical software package' },
  { code: '48190000', label: 'Educational software package' },
  { code: '48200000', label: 'Networking, Internet and intranet software package' },
  { code: '48210000', label: 'Networking software package' },
  { code: '48220000', label: 'Internet and intranet software package' },
  {
    code: '48300000',
    label: 'Document creation, drawing, imaging, scheduling and productivity software package',
  },
  { code: '48310000', label: 'Document creation software package' },
  { code: '48320000', label: 'Drawing and imaging software package' },
  { code: '48330000', label: 'Scheduling and productivity software package' },
  { code: '48400000', label: 'Business transaction and personal business software package' },
  { code: '48410000', label: 'Investment management and tax preparation software package' },
  { code: '48420000', label: 'Facilities management software package and software package suite' },
  { code: '48430000', label: 'Inventory management software package' },
  { code: '48440000', label: 'Financial analysis and accounting software package' },
  { code: '48450000', label: 'Time accounting or human resources software package' },
  {
    code: '48460000',
    label: 'Analytical, scientific, mathematical or forecasting software package',
  },
  { code: '48470000', label: 'Auction software package' },
  { code: '48480000', label: 'Sales, marketing and business intelligence software package' },
  { code: '48490000', label: 'Procurement software package' },
  { code: '48500000', label: 'Communication and multimedia software package' },
  { code: '48510000', label: 'Communication software package' },
  { code: '48520000', label: 'Multimedia software package' },
  { code: '48600000', label: 'Database and operating software package' },
  { code: '48610000', label: 'Database systems' },
  { code: '48620000', label: 'Operating systems' },
  { code: '48700000', label: 'Software package utilities' },
  { code: '48710000', label: 'Backup or recovery software package' },
  { code: '48720000', label: 'Bar coding software package' },
  { code: '48730000', label: 'Security software package' },
  { code: '48740000', label: 'Foreign language translation software package' },
  { code: '48750000', label: 'Storage media loading software package' },
  { code: '48760000', label: 'Virus protection software package' },
  { code: '48770000', label: 'General, compression and print utility software package' },
  { code: '48780000', label: 'System, storage and content management software package' },
  { code: '48790000', label: 'Version checker software package' },
  { code: '48800000', label: 'Information systems and servers' },
  { code: '48810000', label: 'Information systems' },
  { code: '48820000', label: 'Servers' },
  { code: '48900000', label: 'Miscellaneous software package and computer systems' },
  { code: '48910000', label: 'Computer game software package, family titles and screen savers' },
  { code: '48920000', label: 'Office automation software package' },
  { code: '48930000', label: 'Training and entertainment software package' },
  { code: '48940000', label: 'Pattern design and calendar software package' },
  { code: '48950000', label: 'Boat-location and public address system' },
  { code: '48960000', label: 'Drivers and system software package' },
  { code: '48970000', label: 'Print shop software package' },
  { code: '48980000', label: 'Programming languages and tools' },
  { code: '48990000', label: 'Spreadsheets and enhancement software package' },
  { code: '64000000', label: 'Postal and telecommunications services' },
  { code: '64200000', label: 'Telecommunications services' },
  { code: '64210000', label: 'Telephone and data transmission services' },
  {
    code: '64220000',
    label: 'Telecommunication services except telephone and data transmission services',
  },
  {
    code: '72000000',
    label: 'IT services: consulting, software development, Internet and support',
  },
  { code: '72100000', label: 'Hardware consultancy services' },
  { code: '72110000', label: 'Hardware selection consultancy services' },
  { code: '72120000', label: 'Hardware disaster-recovery consultancy services' },
  { code: '72130000', label: 'Computer-site planning consultancy services' },
  { code: '72140000', label: 'Computer hardware acceptance testing consultancy services' },
  { code: '72150000', label: 'Computer audit consultancy and hardware consultancy services' },
  { code: '72200000', label: 'Software programming and consultancy services' },
  { code: '72210000', label: 'Programming services of packaged software products' },
  { code: '72212000', label: 'Programming services of application software' },
  { code: '72220000', label: 'Systems and technical consultancy services' },
  { code: '72221000', label: 'Business analysis consultancy services' },
  {
    code: '72222000',
    label: 'Information systems or technology strategic review and planning services',
  },
  { code: '72222300', label: 'Information technology services' },
  { code: '72223000', label: 'Information technology requirements review services' },
  { code: '72224000', label: 'Project management consultancy services' },
  { code: '72224100', label: 'System implementation planning services' },
  { code: '72225000', label: 'System quality assurance assessment and review services' },
  { code: '72226000', label: 'System software acceptance testing consultancy services' },
  { code: '72227000', label: 'Software integration consultancy services' },
  { code: '72228000', label: 'Hardware integration consultancy services' },
  { code: '72230000', label: 'Custom software development services' },
  { code: '72232000', label: 'Development of transaction processing and custom software' },
  { code: '72240000', label: 'Systems analysis and programming services' },
  { code: '72243000', label: 'Programming services' },
  { code: '72246000', label: 'Systems consultancy services' },
  { code: '72250000', label: 'System and support services' },
  { code: '72253000', label: 'Helpdesk and support services' },
  { code: '72253100', label: 'Helpdesk services' },
  { code: '72253200', label: 'Systems support services' },
  { code: '72254000', label: 'Software testing' },
  { code: '72260000', label: 'Software-related services' },
  { code: '72261000', label: 'Software support services' },
  { code: '72262000', label: 'Software development services' },
  { code: '72263000', label: 'Software implementation services' },
  { code: '72265000', label: 'Software configuration services' },
  { code: '72266000', label: 'Software consultancy services' },
  { code: '72267100', label: 'Maintenance of information technology software' },
  { code: '72268000', label: 'Software supply services' },
  { code: '72300000', label: 'Data services' },
  { code: '72310000', label: 'Data-processing services' },
  { code: '72315000', label: 'Data network management and support services' },
  { code: '72320000', label: 'Database services' },
  { code: '72330000', label: 'Content or data standardization and classification services' },
  { code: '72400000', label: 'Internet services' },
  { code: '72410000', label: 'Provider services' },
  { code: '72420000', label: 'Internet development services' },
  { code: '72500000', label: 'Computer-related services' },
  { code: '72510000', label: 'Computer-related management services' },
  { code: '72540000', label: 'Computer upgrade services' },
  { code: '72590000', label: 'Computer-related professional services' },
  { code: '72600000', label: 'Computer support and consultancy services' },
  { code: '72610000', label: 'Computer support services' },
  { code: '72611000', label: 'Technical computer support services' },
  { code: '72700000', label: 'Computer network services' },
  { code: '72710000', label: 'Local area network services' },
  { code: '72720000', label: 'Wide area network services' },
  { code: '72800000', label: 'Computer audit and testing services' },
  { code: '72810000', label: 'Computer audit services' },
  { code: '72820000', label: 'Computer testing services' },
  { code: '72900000', label: 'Computer back-up and catalogue conversion services' },
  { code: '72910000', label: 'Computer back-up services' },
  { code: '72920000', label: 'Computer catalogue conversion services' },
  {
    code: '79000000',
    label: 'Business services: law, marketing, consulting, recruitment, printing and security',
  },
  { code: '79400000', label: 'Business and management consultancy and related services' },
  { code: '79410000', label: 'Business and management consultancy services' },
  { code: '79417000', label: 'Safety consultancy services' },
  { code: '79420000', label: 'Management-related services' },
  { code: '80000000', label: 'Education and training services' },
  { code: '80500000', label: 'Training services' },
  { code: '80510000', label: 'Specialist training services' },
  { code: '80530000', label: 'Vocational training services' },
  { code: '80533100', label: 'Computer training services' },
];
