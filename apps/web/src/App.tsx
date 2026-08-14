import type { ReactElement } from 'react';
import {
  DECISION_SUPPORT_DISCLAIMER,
  HEADLINE,
  PRODUCT_NAME,
  SUBHEADLINE,
  TED_ATTRIBUTION,
} from './copy';

export function App(): ReactElement {
  return (
    <>
      <header>
        <p className="product-name">{PRODUCT_NAME}</p>
      </header>
      <main>
        <h1>{HEADLINE}</h1>
        <p className="subheadline">{SUBHEADLINE}</p>
        <a className="cta" href="/pilot">
          Join the founding pilot
        </a>
      </main>
      <footer>
        <p>{TED_ATTRIBUTION}</p>
        <p>{DECISION_SUPPORT_DISCLAIMER}</p>
      </footer>
    </>
  );
}
