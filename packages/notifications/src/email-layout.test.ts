import { describe, expect, it } from 'vitest';

import { emailButton, emailLink, renderEmailLayout } from './email-layout';

describe('renderEmailLayout', () => {
  it('renders a table-based document with the BidMorrow wordmark and the given subject/body/footer', () => {
    const html = renderEmailLayout({
      subject: 'Test subject',
      bodyHtml: '<p>hello</p>',
      footerHtml: '<p>footer</p>',
    });
    expect(html).toContain('<!doctype html>');
    expect(html).toContain('<table');
    expect(html).toContain('BidMorrow');
    expect(html).toContain('Test subject');
    expect(html).toContain('<p>hello</p>');
    expect(html).toContain('<p>footer</p>');
    // No remote images/scripts — text-only wordmark, no CSP-hostile assets.
    expect(html).not.toContain('<img');
    expect(html).not.toContain('<script');
    expect(html).not.toContain('<svg');
  });

  it('escapes the subject before it lands in <title>', () => {
    const html = renderEmailLayout({
      subject: '<script>alert(1)</script>',
      bodyHtml: '<p>x</p>',
      footerHtml: '<p>y</p>',
    });
    expect(html).not.toContain('<script>alert(1)</script>');
    expect(html).toContain('&lt;script&gt;');
  });
});

describe('emailButton', () => {
  it('escapes both the url and the label, and uses the brand accent colour', () => {
    const html = emailButton('https://example.com/a?b=1&c=2', 'Click "here" <now>');
    expect(html).toContain('background:#0f7d6f');
    expect(html).toContain('color:#ffffff');
    expect(html).toContain('href="https://example.com/a?b=1&amp;c=2"');
    expect(html).toContain('Click &quot;here&quot; &lt;now&gt;');
    expect(html).not.toContain('<now>');
  });
});

describe('emailLink', () => {
  it('escapes both the url and the label, and uses the brand accent colour for text', () => {
    const html = emailLink('https://example.com/a?b=1&c=2', 'Manage preferences');
    expect(html).toContain('color:#0f7d6f');
    expect(html).toContain('href="https://example.com/a?b=1&amp;c=2"');
    expect(html).toContain('Manage preferences');
  });
});
