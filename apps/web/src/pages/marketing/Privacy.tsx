import type { ReactElement } from 'react';
import { PageMeta } from '../../components/PageMeta';
import { MARKETING_META } from '../../lib/seo';

export function Privacy(): ReactElement {
  return (
    <>
      <PageMeta {...MARKETING_META.privacy} />

      <p className="mkt-eyebrow">Privacy</p>
      <h1>Privacy</h1>

      <p className="mkt-muted">Last updated 30 August 2026.</p>

      <div className="mkt-prose">
        <h2>What we collect</h2>
        <ul>
          <li>
            Account information you provide: email, password (hashed), company profile fields you
            enter.
          </li>
          <li>
            Product usage events needed to operate the service (e.g. which tenders you save or
            ignore).
          </li>
          <li>
            No third-party analytics or session replay tooling. See our product scope for what we
            deliberately don't do.
          </li>
        </ul>

        <h2>What we don't do</h2>
        <ul>
          <li>We don't sell your data.</li>
          <li>
            We don't guarantee eligibility, compliance, or accuracy of any procurement notice we
            show you.
          </li>
          <li>
            We don't ingest or claim exhaustive coverage of all EU procurement notices. See our
            methodology page.
          </li>
        </ul>

        <h2>Deleting your account</h2>
        <p>
          You can delete your account and its data from Settings at any time, subject to
          organization transfer/ownership constraints described there.
        </p>

        <h2>Contact &amp; data requests</h2>
        {/* Owner decision 2026-08-16: contact is email-only, with no postal
            address published (HUMAN_DECISION_BLOCKERS item 7). */}
        <p>
          Privacy questions and data requests (access, correction, deletion):{' '}
          <a href="mailto:privacy@bidmorrow.com">privacy@bidmorrow.com</a>. General support:{' '}
          <a href="mailto:support@bidmorrow.com">support@bidmorrow.com</a>.
        </p>
      </div>
    </>
  );
}
