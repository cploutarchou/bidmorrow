import type { ReactElement } from 'react';
import { PageMeta } from '../../components/PageMeta';
import { MARKETING_META } from '../../lib/seo';

export function Contact(): ReactElement {
  return (
    <>
      <PageMeta {...MARKETING_META.contact} />

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
