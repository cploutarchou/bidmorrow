import type { ReactElement, ReactNode } from 'react';
import { Link } from 'react-router';
import { DECISION_SUPPORT_DISCLAIMER, PRODUCT_NAME, TED_ATTRIBUTION } from '../copy';
import { ThemeToggle } from './ThemeToggle';

const NAV_LINKS: { to: string; label: string }[] = [
  { to: '/pricing', label: 'Pricing' },
  { to: '/how-it-works', label: 'How it works' },
  { to: '/methodology', label: 'Methodology' },
  { to: '/pilot', label: 'Founding pilot' },
];

/**
 * Shared shell for every marketing page (Direction G "Strata" mockup,
 * docs/redesign/mockups/direction-g-strata.html `.nav`/`.footer`). `.cta`
 * and `.site-header` are also rendered by the auth pages
 * (`pages/auth/AuthLayout.tsx`) and, for `.cta`, by the already-Strata app
 * screens — their styling lives in styles.css as a shared upgrade, not a
 * `.mkt-*`-namespaced one, so it stays visually coherent everywhere it's
 * used. `fullBleed` opts a page's `<main>` out of the shared centered
 * text-column container so it can run its own full-width Strata sections
 * (Home only, today) without affecting any other marketing page.
 */
export function MarketingLayout({
  children,
  fullBleed = false,
}: {
  children: ReactNode;
  fullBleed?: boolean;
}): ReactElement {
  return (
    <>
      <a className="skip-link" href="#main-content">
        Skip to main content
      </a>
      <header className="site-header glass">
        <nav className="mkt-wrap" aria-label="Main">
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
            <ThemeToggle />
          </div>
        </nav>
      </header>
      <main id="main-content" className={fullBleed ? 'mkt-main--full' : undefined}>
        {children}
      </main>
      <footer className="mkt-footer">
        <div className="mkt-wrap mkt-footer__inner">
          <div className="mkt-footer__brand">
            <Link className="mkt-footer__wordmark" to="/">
              {PRODUCT_NAME}
            </Link>
            <p>{TED_ATTRIBUTION}</p>
            <p>{DECISION_SUPPORT_DISCLAIMER}</p>
          </div>
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
        </div>
      </footer>
    </>
  );
}
