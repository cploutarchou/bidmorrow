import { Menu, X } from 'lucide-react';
import { useEffect, useId, useRef, useState, type ReactElement, type ReactNode } from 'react';
import { Link, useLocation } from 'react-router';
import { DECISION_SUPPORT_DISCLAIMER, PRODUCT_NAME, TED_ATTRIBUTION } from '../copy';
import { usePublicConfig } from '../lib/public-config';
import { CookieConsent, ConsentFooterControls } from './CookieConsent';
import { LaunchCountdown } from './LaunchCountdown';
import { Logo } from './Logo';
import { ThemeToggle } from './ThemeToggle';

const NAV_LINKS: { to: string; label: string }[] = [
  { to: '/pricing', label: 'Pricing' },
  { to: '/how-it-works', label: 'How it works' },
  { to: '/sample-verdicts', label: 'Sample verdicts' },
  { to: '/methodology', label: 'Methodology' },
  { to: '/pilot', label: 'Founding pilot' },
];

/**
 * Shared shell for every marketing page (Direction B "Control Room" mockup,
 * docs/redesign/mockups/direction-b-control-room.html `header.site`/
 * `footer.site`). `.cta` and `.site-header` are also rendered by the auth
 * pages (`pages/auth/AuthLayout.tsx`) and, for `.cta`, by the app screens —
 * their styling lives in styles.css as a shared upgrade, not a
 * `.mkt-*`-namespaced one, so it stays visually coherent everywhere it's
 * used. `fullBleed` opts a page's `<main>` out of the shared centered
 * text-column container so it can run its own full-width sections (Home
 * only, today) without affecting any other marketing page.
 *
 * Below ~56rem (900px, styles.css `MARKETING SITE` section) the inline
 * `.nav-list`/`.nav-actions` are hidden and replaced with a hamburger
 * toggle that opens `.mkt-menu-panel` — a dropdown holding the same links
 * plus Log in / Sign up. The mockup only hides the nav links under its
 * equivalent breakpoint and leaves nothing in their place; that's the
 * "3 stacked rows" bug this component fixes, so this menu is a deliberate
 * improvement on the mockup rather than a literal port of it. Single-theme
 * dark only (2026-08-18 decision log) — there is no theme toggle anywhere
 * in this shell.
 */
export function MarketingLayout({
  children,
  fullBleed = false,
}: {
  children: ReactNode;
  fullBleed?: boolean;
}): ReactElement {
  const [menuOpen, setMenuOpen] = useState(false);
  const panelId = useId();
  const toggleButtonRef = useRef<HTMLButtonElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const location = useLocation();
  const publicConfig = usePublicConfig();

  // Scroll-triggered reveals (docs/redesign/app-interface-spec.md §8.4) —
  // progressive enhancement: `.mkt-reveal` is only ever hidden under the
  // `js-reveal` root class this effect adds, so content is fully visible if
  // JS never runs. Re-observes on every route change (marketing pages are
  // client-side navigated, so a fresh mount effect alone wouldn't re-run
  // per page).
  useEffect(() => {
    document.documentElement.classList.add('js-reveal');
    const targets = document.querySelectorAll<HTMLElement>('.mkt-reveal:not(.is-in)');
    if (typeof IntersectionObserver === 'undefined') {
      for (const el of targets) el.classList.add('is-in');
      return;
    }
    const observer = new IntersectionObserver(
      (entries, obs) => {
        for (const entry of entries) {
          if (!entry.isIntersecting) continue;
          entry.target.classList.add('is-in');
          obs.unobserve(entry.target);
        }
      },
      { rootMargin: '0px 0px -10%', threshold: 0.15 },
    );
    for (const el of targets) observer.observe(el);
    return () => observer.disconnect();
  }, [location.pathname]);

  function closeMenu(): void {
    setMenuOpen(false);
  }

  // Esc closes the panel and returns focus to the toggle button; a
  // click/tap anywhere outside the panel and the toggle button also
  // closes it. Only wired up while the panel is actually open.
  useEffect(() => {
    if (!menuOpen) return;

    function handleKeyDown(event: KeyboardEvent): void {
      if (event.key !== 'Escape') return;
      setMenuOpen(false);
      toggleButtonRef.current?.focus();
    }

    function handlePointerDown(event: PointerEvent): void {
      const target = event.target;
      if (!(target instanceof Node)) return;
      if (panelRef.current?.contains(target) === true) return;
      if (toggleButtonRef.current?.contains(target) === true) return;
      setMenuOpen(false);
    }

    document.addEventListener('keydown', handleKeyDown);
    document.addEventListener('pointerdown', handlePointerDown);
    return () => {
      document.removeEventListener('keydown', handleKeyDown);
      document.removeEventListener('pointerdown', handlePointerDown);
    };
  }, [menuOpen]);

  // Move focus into the panel (its first link) the moment it opens.
  useEffect(() => {
    if (!menuOpen) return;
    panelRef.current?.querySelector<HTMLElement>('a, button')?.focus();
  }, [menuOpen]);

  return (
    <>
      <a className="skip-link" href="#main-content">
        Skip to main content
      </a>
      {publicConfig?.prelaunch === true && (
        <div className="launch-banner" role="status">
          <div className="mkt-wrap launch-banner__inner">
            <LaunchCountdown launchDate={publicConfig.launchDate} />
            <span className="launch-banner__note">Registrations open at launch</span>
          </div>
        </div>
      )}
      <header className="site-header glass">
        <nav className="mkt-wrap" aria-label="Main">
          <Link className="wordmark" to="/" aria-label="BidMorrow home">
            <Logo className="brand-mark" />
            <span className="product-name">{PRODUCT_NAME}</span>
          </Link>

          <ul className="nav-list">
            {NAV_LINKS.map((link) => (
              <li key={link.to}>
                <Link to={link.to}>{link.label}</Link>
              </li>
            ))}
          </ul>
          <div className="nav-actions">
            <ThemeToggle />
            <Link to="/login">Log in</Link>
            <Link className="cta cta-small" to="/signup">
              Sign up
            </Link>
          </div>

          <button
            type="button"
            className="mkt-menu-toggle"
            aria-expanded={menuOpen}
            aria-controls={panelId}
            aria-label={menuOpen ? 'Close menu' : 'Open menu'}
            onClick={() => setMenuOpen((open) => !open)}
            ref={toggleButtonRef}
          >
            {menuOpen ? <X aria-hidden="true" /> : <Menu aria-hidden="true" />}
          </button>

          <div
            id={panelId}
            ref={panelRef}
            className={menuOpen ? 'mkt-menu-panel is-open' : 'mkt-menu-panel'}
            inert={!menuOpen}
          >
            <ul className="mkt-menu-panel__links">
              {NAV_LINKS.map((link) => (
                <li key={link.to}>
                  <Link to={link.to} onClick={closeMenu}>
                    {link.label}
                  </Link>
                </li>
              ))}
            </ul>
            <div className="mkt-menu-panel__actions">
              <ThemeToggle />
              <Link to="/login" onClick={closeMenu}>
                Log in
              </Link>
              <Link className="cta" to="/signup" onClick={closeMenu}>
                Sign up
              </Link>
            </div>
          </div>
        </nav>
      </header>
      <main id="main-content" className={fullBleed ? 'mkt-main--full' : undefined}>
        {children}
      </main>
      <footer className="mkt-footer">
        <div className="mkt-wrap mkt-footer__inner">
          <div className="mkt-footer__brand">
            <Link className="mkt-footer__wordmark" to="/" aria-label="BidMorrow home">
              <Logo className="brand-mark" />
              <span className="product-name">{PRODUCT_NAME}</span>
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
          <ConsentFooterControls />
        </div>
      </footer>
      <CookieConsent />
    </>
  );
}
