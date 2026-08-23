import '../../styles/auth.css';
import type { ReactElement, ReactNode } from 'react';
import { Link } from 'react-router';
import { PRODUCT_NAME } from '../../copy';
import { Logo } from '../../components/Logo';
import { ThemeToggle } from '../../components/ThemeToggle';
import { NoIndex } from '../../components/NoIndex';

/**
 * Shared shell for the five auth screens — 2026-08-21 handoff redesign
 * (`BidMorrow Auth.dc.html`): a two-column split with a routing-rules
 * aside on the left and the form card on the right. The aside explains
 * the real post-auth routing contract (lib/post-auth-route.ts) and is
 * hidden under the design's 980px breakpoint; the card's `title` stays
 * the page's single visible `<h1>` at every width. The prototype's
 * screen tabs and account simulator are prototype-only and not ported.
 */

const ROUTING_RULES: { tag: string; text: string }[] = [
  {
    tag: 'Saved destination wins',
    text: 'A destination carried in the link is used as-is, provided it is a plain path on this site — never a full URL.',
  },
  {
    tag: 'Otherwise, by state',
    text: 'No organization, or a profile never marked complete, goes to onboarding; a complete profile goes to the feed.',
  },
  {
    tag: 'Verification first',
    text: 'An unverified account is refused at login with a resend offer, not silently dropped at the feed.',
  },
];

export function AuthLayout({
  title,
  subtitle,
  children,
}: {
  title: string;
  subtitle?: string;
  children: ReactNode;
}): ReactElement {
  return (
    <>
      <title>{`${title} — ${PRODUCT_NAME}`}</title>
      <NoIndex />
      {/* Phase 12 stage A: AppShell already had a skip-link; AuthLayout
          (login/signup/verify/reset) didn't — found via the keyboard
          traversal E2E spec, fixed for consistency across every page shell. */}
      <a className="skip-link" href="#main-content">
        Skip to main content
      </a>
      <header className="site-header glass">
        <div className="mkt-wrap auth-header-row">
          <Link className="wordmark" to="/">
            <Logo className="brand-mark" />
            <span className="product-name">{PRODUCT_NAME}</span>
          </Link>
          <ThemeToggle />
        </div>
      </header>
      <main id="main-content" className="auth-main">
        <div className="auth-split">
          <aside className="auth-aside" aria-hidden="true">
            <div className="auth-aside__head">
              <p className="auth-aside__eyebrow">Account access</p>
              <p className="auth-aside__headline">Sign in and land where you left off.</p>
              <p className="auth-aside__lede">
                Where you land is decided by the state of your account, not a fixed URL — a saved
                destination wins, an unfinished profile goes to onboarding, a complete one goes to
                your feed.
              </p>
            </div>
            <div className="mkt-cellgrid mkt-cellgrid--rows">
              {ROUTING_RULES.map((rule) => (
                <div className="mkt-cell" key={rule.tag}>
                  <p className="mkt-cell__cap mkt-cell__cap--accent">{rule.tag}</p>
                  <p>{rule.text}</p>
                </div>
              ))}
            </div>
          </aside>
          <div className="auth-card">
            <div className="auth-card__head">
              <h1>{title}</h1>
              {subtitle !== undefined && <p className="auth-card__sub">{subtitle}</p>}
            </div>
            {children}
          </div>
        </div>
      </main>
    </>
  );
}
