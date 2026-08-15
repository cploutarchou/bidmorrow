import type { ReactElement } from 'react';

export function Privacy(): ReactElement {
  return (
    <>
      <title>Privacy — BidMorrow</title>
      <meta name="description" content="BidMorrow privacy summary — final legal text pending." />
      <link rel="canonical" href="https://bidmorrow.com/privacy" />
      <h1>Privacy</h1>
      <p>
        <strong>Final legal text pending.</strong> This page is an honest summary of our current
        practices, not a substitute for a lawyer-reviewed privacy policy. We will replace this page
        with full legal text before general availability.
      </p>
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
          No third-party analytics or session replay tooling — see our product scope for what we
          deliberately don't do.
        </li>
      </ul>
      <h2>What we don't do</h2>
      <ul>
        <li>We don't sell your data.</li>
        <li>
          We don't guarantee eligibility, compliance, or accuracy of any procurement notice we show
          you.
        </li>
        <li>
          We don't ingest or claim exhaustive coverage of all EU procurement notices — see our
          methodology page.
        </li>
      </ul>
      <h2>Deleting your account</h2>
      <p>
        You can delete your account and its data from Settings at any time, subject to organization
        transfer/ownership constraints described there.
      </p>
    </>
  );
}
