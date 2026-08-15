import type { ReactElement } from 'react';

export function Contact(): ReactElement {
  return (
    <>
      <title>Contact — BidMorrow</title>
      <meta name="description" content="Contact BidMorrow support." />
      <link rel="canonical" href="https://bidmorrow.com/contact" />
      <h1>Contact</h1>
      <p>
        For support, billing, or general questions, email{' '}
        <a href="mailto:support@bidmorrow.com">support@bidmorrow.com</a>.
      </p>
    </>
  );
}
