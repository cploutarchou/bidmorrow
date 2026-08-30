import { describe, expect, it, vi } from 'vitest';

import { PermanentEmailError, RetryableEmailError, createResendEmailProvider } from './resend';

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

const MESSAGE = {
  to: 'owner@example.com',
  kind: 'digest' as const,
  subject: 'Digest',
  html: '<p>hi</p>',
  text: 'hi',
};

describe('createResendEmailProvider', () => {
  it('sends a POST with the bearer token and returns the providerMessageId on success', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(jsonResponse(200, { id: 'msg-123' }));
    const provider = createResendEmailProvider({
      apiKey: 'secret-key',
      from: 'digest@bidmorrow.com',
      fetchImpl,
    });

    const result = await provider.send(MESSAGE);

    expect(result).toEqual({ providerMessageId: 'msg-123' });
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    const [url, init] = fetchImpl.mock.calls[0] as [string, RequestInit];
    expect(url).toBe('https://api.resend.com/emails');
    expect((init.headers as Record<string, string>).Authorization).toBe('Bearer secret-key');
    const body = JSON.parse(init.body as string) as { to: string[]; from: string };
    expect(body.to).toEqual(['owner@example.com']);
    expect(body.from).toBe('digest@bidmorrow.com');
  });

  it('classifies 429 as retryable', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(jsonResponse(429, { message: 'rate limited' }));
    const provider = createResendEmailProvider({ apiKey: 'k', from: 'f@bidmorrow.com', fetchImpl });
    await expect(provider.send(MESSAGE)).rejects.toBeInstanceOf(RetryableEmailError);
  });

  it('classifies 5xx as retryable', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(jsonResponse(503, { message: 'down' }));
    const provider = createResendEmailProvider({ apiKey: 'k', from: 'f@bidmorrow.com', fetchImpl });
    await expect(provider.send(MESSAGE)).rejects.toBeInstanceOf(RetryableEmailError);
  });

  it('classifies 4xx (non-429) as permanent', async () => {
    const fetchImpl = vi
      .fn()
      .mockResolvedValue(jsonResponse(422, { message: 'invalid from address' }));
    const provider = createResendEmailProvider({ apiKey: 'k', from: 'f@bidmorrow.com', fetchImpl });
    await expect(provider.send(MESSAGE)).rejects.toBeInstanceOf(PermanentEmailError);
  });

  it('classifies a network failure as retryable', async () => {
    const fetchImpl = vi.fn().mockRejectedValue(new Error('network down'));
    const provider = createResendEmailProvider({ apiKey: 'k', from: 'f@bidmorrow.com', fetchImpl });
    await expect(provider.send(MESSAGE)).rejects.toBeInstanceOf(RetryableEmailError);
  });

  it('never includes the API key in a thrown error message', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(jsonResponse(422, { message: 'bad request' }));
    const provider = createResendEmailProvider({
      apiKey: 'super-secret-key',
      from: 'f@bidmorrow.com',
      fetchImpl,
    });
    await expect(provider.send(MESSAGE)).rejects.toThrow(/^(?!.*super-secret-key).*$/);
  });

  it('spaces sequential sends at least 600ms apart on the same provider instance', async () => {
    vi.useFakeTimers();
    try {
      const fetchImpl = vi
        .fn()
        .mockImplementation(() => Promise.resolve(jsonResponse(200, { id: 'msg-1' })));
      const provider = createResendEmailProvider({
        apiKey: 'k',
        from: 'f@bidmorrow.com',
        fetchImpl,
      });

      const first = provider.send(MESSAGE);
      await vi.advanceTimersByTimeAsync(0);
      await first;

      const second = provider.send(MESSAGE);
      // Not yet resolved just after issuing — the spacing wait blocks it.
      await vi.advanceTimersByTimeAsync(500);
      expect(fetchImpl).toHaveBeenCalledTimes(1);
      await vi.advanceTimersByTimeAsync(200);
      await second;
      expect(fetchImpl).toHaveBeenCalledTimes(2);
    } finally {
      vi.useRealTimers();
    }
  });
});

// SEC-UNSUB-02: defense in depth at the provider boundary — a future caller
// interpolating a source-derived string into a header must not be able to
// split it. Today's caller cannot, which is exactly why this needs a test.
describe('custom header passthrough', () => {
  it('forwards headers when present and omits the field entirely when absent', async () => {
    const calls: RequestInit[] = [];
    const fetchImpl = (async (_url: string, init: RequestInit) => {
      calls.push(init);
      return new Response(JSON.stringify({ id: 'msg_1' }), { status: 200 });
    }) as unknown as typeof fetch;
    const provider = createResendEmailProvider({ apiKey: 'k', from: 'a@b.test', fetchImpl });

    await provider.send({
      to: 'x@example.test',
      kind: 'digest',
      subject: 's',
      html: '<p>h</p>',
      text: 't',
      headers: { 'List-Unsubscribe': '<https://example.test/u?token=a.b>' },
    });
    expect(JSON.parse(String(calls[0]?.body)).headers).toEqual({
      'List-Unsubscribe': '<https://example.test/u?token=a.b>',
    });

    await provider.send({
      to: 'x@example.test',
      kind: 'digest',
      subject: 's',
      html: '<p>h</p>',
      text: 't',
    });
    expect(JSON.parse(String(calls[1]?.body))).not.toHaveProperty('headers');
  });

  it('refuses to send a header carrying CR, LF or NUL, and never echoes the value', async () => {
    const fetchImpl = (async () =>
      new Response(JSON.stringify({ id: 'msg_1' }), { status: 200 })) as unknown as typeof fetch;
    const provider = createResendEmailProvider({ apiKey: 'k', from: 'a@b.test', fetchImpl });

    for (const headers of [
      { 'List-Unsubscribe': '<https://e.test>\r\nBcc: attacker@evil.test' },
      { 'List-Unsubscribe': '<https://e.test>\nBcc: attacker@evil.test' },
      { 'X-Bad\r\nInjected': 'value' },
      { 'List-Unsubscribe': 'a\0b' },
    ]) {
      await expect(
        provider.send({
          to: 'x@example.test',
          kind: 'digest',
          subject: 's',
          html: '<p>h</p>',
          text: 't',
          headers,
        }),
      ).rejects.toThrow(/control character/);
    }
  });
});
