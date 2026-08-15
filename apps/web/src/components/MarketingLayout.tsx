import type { ReactElement, ReactNode } from 'react';
import { Link } from 'react-router';
import { DECISION_SUPPORT_DISCLAIMER, PRODUCT_NAME, TED_ATTRIBUTION } from '../copy';

const NAV_LINKS: { to: string; label: string }[] = [
  { to: '/pricing', label: 'Pricing' },
  { to: '/how-it-works', label: 'How it works' },
  { to: '/methodology', label: 'Methodology' },
  { to: '/pilot', label: 'Founding pilot' },
];

export function MarketingLayout({ children }: { children: ReactNode }): ReactElement {
  return (
    <>
      <a className="skip-link" href="#main-content">
        Skip to main content
      </a>
      <header className="site-header">
        <nav aria-label="Main">
          <Link className="product-name" to="/">
            {PRODUCT_NAME}
          </Link>
          <ul className="nav-list">
            {NAV_LINKS.map((link) => (
              <li key={link.to}>
                <Link to={link.to}>{link.label}</Link>
              </li>
            ))}
          </ul>
          <div className="nav-actions">
            <Link to="/login">Log in</Link>
            <Link className="cta cta-small" to="/signup">
              Sign up
            </Link>
          </div>
        </nav>
      </header>
      <main id="main-content">{children}</main>
      <footer>
        <nav aria-label="Footer">
          <ul className="nav-list">
            <li>
              <Link to="/privacy">Privacy</Link>
            </li>
            <li>
              <Link to="/terms">Terms</Link>
            </li>
            <li>
              <Link to="/contact">Contact</Link>
            </li>
          </ul>
        </nav>
        <p>{TED_ATTRIBUTION}</p>
        <p>{DECISION_SUPPORT_DISCLAIMER}</p>
      </footer>
    </>
  );
}
