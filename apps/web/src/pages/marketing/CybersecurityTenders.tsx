import type { ReactElement } from 'react';
import { Link } from 'react-router';
import {
  DECISION_SUPPORT_DISCLAIMER,
  SCOPED_COVERAGE_STATEMENT,
  TED_ATTRIBUTION,
} from '../../copy';
import { PageMeta } from '../../components/PageMeta';
import { MARKETING_META } from '../../lib/seo';
import { SampleVerdictCard } from '../../components/SampleVerdictCard';
import { SAMPLE_VERDICTS, SAMPLE_VERDICT_SCORED_AT } from '../../lib/sample-verdicts.generated';

/**
 * /cybersecurity-tenders: the first of the policy's manually authored
 * commercial category pages (docs/product-scope.md "Product policy lock",
 * owner decision 2026-08-17: "hand-written page explaining the qualification
 * methodology and showing sample verdicts. These are NOT auto-generated
 * tender directories").
 *
 * That last sentence is the design constraint. This page lists no live
 * tenders, has no feed, and never will. It explains how BidMorrow qualifies
 * cybersecurity tenders and shows two real, engine-scored examples from the
 * shared sample-verdict set (`lib/sample-verdicts.generated.ts`, surface
 * `cybersecurity`). Everything CPV-related below is checkable against the
 * CPV 2008 codelist; the coverage statement is the same one the rest of the
 * site uses, not a wider claim invented for a landing page.
 */

const SCORED_AT_LABEL = new Date(SAMPLE_VERDICT_SCORED_AT).toISOString().slice(0, 10);

/**
 * CPV codes a cybersecurity consultancy actually meets in notices. Labels
 * are the official CPV 2008 English wording, each extracted verbatim from
 * the Publications Office cpv genericode codelist (eForms SDK 1.13.2
 * `codelists/cpv.gc`) on 2026-08-23, the same source
 * `data/cpv-suggestions.ts` uses, never recalled from memory. The point this list makes is the page's core
 * argument: there is no single "cybersecurity CPV", so code-watching alone
 * either drowns you (watch all of 72*) or misses work (watch only 48730000).
 */
const CYBER_CPVS: { code: string; label: string }[] = [
  { code: '72800000', label: 'Computer audit and testing services' },
  { code: '48730000', label: 'Security software package' },
  { code: '72222300', label: 'Information technology services' },
  { code: '72510000', label: 'Computer-related management services' },
  { code: '72514100', label: 'Facilities management services involving computer operation' },
  { code: '79417000', label: 'Safety consultancy services' },
];

export function CybersecurityTenders(): ReactElement {
  const verdicts = SAMPLE_VERDICTS.filter((verdict) => verdict.surfaces.includes('cybersecurity'));

  return (
    <>
      <PageMeta {...MARKETING_META.cybersecurityTenders} />

      <section className="mkt-section">
        <div className="mkt-wrap">
          <p className="mkt-eyebrow">Cybersecurity tenders</p>
          <h1 className="mkt-sec-title">
            How to qualify EU cybersecurity tenders without reading all of them
          </h1>
          <p className="mkt-standfirst">
            Public buyers across the EU procure penetration tests, security operations centres,
            ISO&nbsp;27001 support and managed security through TED, but rarely under a CPV code
            that says &ldquo;cybersecurity&rdquo;. This page explains how BidMorrow qualifies these
            notices for a security consultancy, and shows two of them scored for real.
          </p>
        </div>
      </section>

      <section className="mkt-section">
        <div className="mkt-wrap">
          <h2 className="mkt-sec-title">Why code-watching alone fails for security work</h2>
          <p className="mkt-sec-lede">
            The CPV vocabulary has no cybersecurity division. Security work is published under codes
            like these, the official CPV&nbsp;2008 wording, none of which names the trade:
          </p>
          <div className="mkt-table-card cpv-label-table">
            <table>
              <thead>
                <tr>
                  <th scope="col">CPV code</th>
                  <th scope="col">Official CPV 2008 label</th>
                </tr>
              </thead>
              <tbody>
                {CYBER_CPVS.map((entry) => (
                  <tr key={entry.code}>
                    <td className="num">{entry.code}</td>
                    <td>{entry.label}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p className="mkt-sec-lede">
            Both failure modes are real. Watch all of CPV&nbsp;72* and a five-person security team
            reads printer-leasing and broadband notices every morning; watch only
            &ldquo;security&rdquo; codes and you miss a Security Operations Centre published under
            72514100, facilities management; a real example is scored below. And CPV 79710000,
            &ldquo;security services&rdquo;, is guards and patrols, not information security: the
            code that sounds most right is usually wrong.
          </p>
          <p className="mkt-sec-lede">
            BidMorrow&rsquo;s answer is a scored profile rather than a code watchlist: CPV proximity
            is the largest single component (35 of 100), but capability keywords, geography,
            contract value, buyer type, procedure, deadline runway and eligibility signals carry the
            remaining 65, so a mislabelled security tender still surfaces, and an in-code tender
            that is not your work still sinks. The <Link to="/methodology">methodology page</Link>{' '}
            publishes every component and every missing-data rule.
          </p>
        </div>
      </section>

      <section className="mkt-section mkt-section--deep">
        <div className="mkt-wrap">
          <h2 className="mkt-sec-title">Two real security tenders, scored</h2>
          <p className="mkt-sec-lede">
            Real notices published on TED, scored by the production engine on {SCORED_AT_LABEL}{' '}
            against a composite profile of a 20-person security consultancy, with the same engine
            and the same eight components every customer gets. The full curated set, including a
            hard-excluded case, is on the <Link to="/sample-verdicts">sample verdicts page</Link>.
          </p>
          <div className="sample-verdicts">
            {verdicts.map((verdict) => (
              <SampleVerdictCard key={verdict.id} verdict={verdict} />
            ))}
          </div>
        </div>
      </section>

      <section className="mkt-section">
        <div className="mkt-wrap">
          <h2 className="mkt-sec-title">Get verdicts matched to your company</h2>
          <p className="mkt-sec-lede">
            These two were scored against a composite profile. Your certifications, languages,
            regions and deal-size range would move every number, which is the point of scoring
            against a profile instead of watching codes.
          </p>
          <p className="mkt-cta-row">
            <Link className="cta" to="/signup">
              Get verdicts matched to your company
            </Link>
          </p>

          <div className="mkt-panel sample-notes">
            <p>{SCOPED_COVERAGE_STATEMENT}</p>
            <p>{DECISION_SUPPORT_DISCLAIMER}</p>
            <p>{TED_ATTRIBUTION}</p>
          </div>
        </div>
      </section>
    </>
  );
}

export default CybersecurityTenders;
