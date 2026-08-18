import type { ReactElement, ReactNode } from 'react';
import { Link } from 'react-router';
import { PRODUCT_NAME } from '../../copy';
import { Logo } from '../../components/Logo';

export function AuthLayout({
  title,
  children,
}: {
  title: string;
  children: ReactNode;
}): ReactElement {
  return (
    <>
      <title>{`${title} — ${PRODUCT_NAME}`}</title>
      {/* Phase 12 stage A: AppShell already had a skip-link; AuthLayout
          (login/signup/verify/reset) didn't — found via the keyboard
          traversal E2E spec, fixed for consistency across every page shell. */}
      <a className="skip-link" href="#main-content">
        Skip to main content
      </a>
      <header className="site-header glass">
        <div className="mkt-wrap">
          <Link className="wordmark" to="/">
            <Logo className="brand-mark" />
            <span className="product-name">{PRODUCT_NAME}</span>
          </Link>
        </div>
      </header>
      <main id="main-content" className="auth-main">
        <h1>{title}</h1>
        {children}
      </main>
    </>
  );
}
