import type { ReactElement, ReactNode } from 'react';
import { Link } from 'react-router';
import { PRODUCT_NAME } from '../../copy';

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
      <header className="site-header">
        <Link className="product-name" to="/">
          {PRODUCT_NAME}
        </Link>
      </header>
      <main id="main-content" className="auth-main">
        <h1>{title}</h1>
        {children}
      </main>
    </>
  );
}
