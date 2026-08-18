import { afterEach, describe, expect, it, vi } from 'vitest';
import { api, ApiError, setUnauthorizedHandler } from './api';

function stubFetch(status: number, body: unknown = {}): void {
  vi.stubGlobal(
    'fetch',
    vi.fn(async () => {
      return new Response(JSON.stringify(body), {
        status,
        headers: { 'content-type': 'application/json' },
      });
    }),
  );
}

describe('api 401 handling', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    setUnauthorizedHandler(null);
  });

  it('invokes the registered handler on a 401 response', async () => {
    stubFetch(401, { message: 'unauthorized' });
    const handler = vi.fn();
    setUnauthorizedHandler(handler);

    await expect(api.get('/api/org/profile')).rejects.toBeInstanceOf(ApiError);
    expect(handler).toHaveBeenCalledTimes(1);
  });

  it('does not invoke the handler on other error statuses', async () => {
    stubFetch(403, { message: 'forbidden' });
    const handler = vi.fn();
    setUnauthorizedHandler(handler);

    await expect(api.get('/api/org/profile')).rejects.toBeInstanceOf(ApiError);
    expect(handler).not.toHaveBeenCalled();
  });

  it('does not invoke the handler on success', async () => {
    stubFetch(200, { ok: true });
    const handler = vi.fn();
    setUnauthorizedHandler(handler);

    await expect(api.get('/api/org/profile')).resolves.toEqual({ ok: true });
    expect(handler).not.toHaveBeenCalled();
  });

  it('stops invoking a deregistered handler (setUnauthorizedHandler(null))', async () => {
    stubFetch(401, {});
    const handler = vi.fn();
    setUnauthorizedHandler(handler);
    setUnauthorizedHandler(null);

    await expect(api.get('/api/org/profile')).rejects.toBeInstanceOf(ApiError);
    expect(handler).not.toHaveBeenCalled();
  });

  it('still throws ApiError with the 401 status even with no handler registered', async () => {
    stubFetch(401, { message: 'unauthorized' });

    await expect(api.get('/api/org/profile')).rejects.toMatchObject({ status: 401 });
  });
});
