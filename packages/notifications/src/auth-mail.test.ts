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
