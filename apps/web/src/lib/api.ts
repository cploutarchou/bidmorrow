/**
 * Tiny same-origin fetch wrapper. No client-side session/role decisions are
 * made here — callers only branch on HTTP status (401/403) to redirect or
 * show a message; the server remains the sole authority on access
 * (.claude/agents/frontend.md "never embed role/organization logic
 * client-side as a security mechanism").
 *
 * `credentials: 'include'` sends the Better Auth session cookie on every
 * same-origin request; Better Auth's CSRF protection is same-origin-cookie
 * based, so no separate CSRF token handling is needed for same-origin fetch.
 */

export class ApiError extends Error {
  readonly status: number;
  readonly body: unknown;

  constructor(status: number, body: unknown) {
    super(`API error ${status}`);
    this.status = status;
    this.body = body;
  }
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(path, {
    ...init,
    credentials: 'include',
    headers: {
      ...(init?.body !== undefined ? { 'content-type': 'application/json' } : {}),
      ...init?.headers,
    },
  });

  const text = await response.text();
  const body: unknown = text.length > 0 ? JSON.parse(text) : null;

  if (!response.ok) {
    throw new ApiError(response.status, body);
  }
  return body as T;
}

export const api = {
  get: <T>(path: string): Promise<T> => request<T>(path, { method: 'GET' }),
  post: <T>(path: string, body?: unknown): Promise<T> =>
    request<T>(
      path,
      body !== undefined ? { method: 'POST', body: JSON.stringify(body) } : { method: 'POST' },
    ),
  put: <T>(path: string, body: unknown): Promise<T> =>
    request<T>(path, { method: 'PUT', body: JSON.stringify(body) }),
  delete: <T>(path: string): Promise<T> => request<T>(path, { method: 'DELETE' }),
};
