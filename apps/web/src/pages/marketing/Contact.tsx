import type { ReactElement } from 'react';

export function Contact(): ReactElement {
  return (
    <>
      <title>Contact — BidMorrow</title>
      <meta name="description" content="Contact BidMorrow support." />
      <link rel="canonical" href="https://bidmorrow.com/contact" />

      <p className="mkt-eyebrow">Contact</p>
      <h1>Contact</h1>

      <div className="mkt-panel glass">
        <p>
          For support, billing, or general questions, email{' '}
          <a href="mailto:support@bidmorrow.com">support@bidmorrow.com</a>.
        </p>
      </div>
    </>
  );
}
