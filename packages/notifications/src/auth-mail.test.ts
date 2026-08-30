import { describe, expect, it, vi } from 'vitest';

import { buildAuthEmailBody, createResendAuthEmailProvider } from './auth-mail';

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

describe('buildAuthEmailBody', () => {
  it('builds a verification body containing the url in text and html', () => {
    const url = 'https://app.bidmorrow.com/verify?token=abc123';
    const body = buildAuthEmailBody('verification', url);
    expect(body.subject).toBe('Verify your email address');
    expect(body.text).toContain(url);
    expect(body.html).toContain(url);
    expect(body.text).not.toContain('<');
  });

  it('builds a password_reset body containing the url in text and html', () => {
    const url = 'https://app.bidmorrow.com/reset?token=xyz789';
    const body = buildAuthEmailBody('password_reset', url);
    expect(body.subject).toBe('Reset your password');
    expect(body.text).toContain(url);
    expect(body.html).toContain(url);
  });

  it('carries the BidMorrow brand, one primary button, and the "if you did not request this" line', () => {
    const url = 'https://app.bidmorrow.com/verify?token=abc123';
    const body = buildAuthEmailBody('verification', url);
    expect(body.html).toContain('BidMorrow');
    // One primary CTA — the button links straight to the raw url.
    expect(body.html).toMatch(
      new RegExp(
        `<a href="${url.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}"[^>]*>Verify email address</a>`,
      ),
    );
    expect(body.html).toMatch(/request this, you can safely ignore this email/i);
    expect(body.text).toMatch(/didn't request this, you can safely ignore this email/i);
    // Raw url printed as plain text too, for clients that strip buttons.
    expect(body.text.split('\n')).toContain(url);
  });

  it('never states an expiry duration that is not actually configured anywhere', () => {
    const body = buildAuthEmailBody('password_reset', 'https://app.bidmorrow.com/reset?token=xyz');
    expect(body.html).not.toMatch(/expires? in/i);
    expect(body.text).not.toMatch(/expires? in/i);
  });

  it('includes the support address in both bodies', () => {
    const body = buildAuthEmailBody('verification', 'https://app.bidmorrow.com/verify?token=abc');
    expect(body.html).toContain('support@bidmorrow.com');
    expect(body.text).toContain('support@bidmorrow.com');
  });

  it('the password_reset text body never contains a literal "<" (plain-text safety)', () => {
    const body = buildAuthEmailBody(
      'password_reset',
      'https://app.bidmorrow.com/reset?token=xyz789',
    );
    expect(body.text).not.toContain('<');
  });
});

describe('createResendAuthEmailProvider', () => {
  it('sends the composed html/text body via Resend', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(jsonResponse(200, { id: 'msg-1' }));
    const provider = createResendAuthEmailProvider({
      apiKey: 'secret-key',
      from: 'auth@bidmorrow.com',
      fetchImpl,
    });

    await provider.send({
      to: 'owner@example.com',
      kind: 'verification',
      url: 'https://app.bidmorrow.com/verify?token=abc123',
    });

    expect(fetchImpl).toHaveBeenCalledTimes(1);
    const [, init] = fetchImpl.mock.calls[0] as [string, RequestInit];
    const body = JSON.parse(init.body as string) as {
      to: string[];
      subject: string;
      html: string;
      text: string;
    };
    expect(body.to).toEqual(['owner@example.com']);
    expect(body.subject).toBe('Verify your email address');
    expect(body.html).toContain('https://app.bidmorrow.com/verify?token=abc123');
    expect(body.text).toContain('https://app.bidmorrow.com/verify?token=abc123');
    // Never logs anything, but assert the fetch call itself never leaks the
    // API key anywhere but the Authorization header.
    expect(JSON.stringify(body)).not.toContain('secret-key');
  });

  it('propagates a permanent error without leaking the API key', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(jsonResponse(422, { message: 'bad request' }));
    const provider = createResendAuthEmailProvider({
      apiKey: 'super-secret-key',
      from: 'auth@bidmorrow.com',
      fetchImpl,
    });
    await expect(
      provider.send({ to: 'a@example.com', kind: 'password_reset', url: 'https://x/reset' }),
    ).rejects.toThrow(/^(?!.*super-secret-key).*$/);
  });
});
