import { afterEach, describe, expect, it, vi } from 'vitest';

import { createLogger } from './index';

function lastLine(spy: { mock: { calls: unknown[][] } }): string {
  const call = spy.mock.calls.at(-1);
  const line = call?.[0];
  if (typeof line !== 'string') {
    throw new Error('expected the logger to emit a string line');
  }
  return line;
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe('createLogger', () => {
  it('emits single-line parseable JSON with ts/level/msg via console.warn', () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => undefined);

    createLogger({ request_id: 'req-1' }).info('feed viewed', { page: 2 });

    expect(warnSpy).toHaveBeenCalledTimes(1);
    const line = lastLine(warnSpy);
    expect(line).not.toContain('\n');
    const record = JSON.parse(line) as Record<string, unknown>;
    expect(record['level']).toBe('info');
    expect(record['msg']).toBe('feed viewed');
    expect(record['request_id']).toBe('req-1');
    expect(record['page']).toBe(2);
    expect(typeof record['ts']).toBe('string');
    expect(() => new Date(record['ts'] as string).toISOString()).not.toThrow();
  });

  it('routes error level to console.error and everything else to console.warn', () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const logger = createLogger();

    logger.debug('d');
    logger.info('i');
    logger.warn('w');
    logger.error('e');

    expect(warnSpy).toHaveBeenCalledTimes(3);
    expect(errorSpy).toHaveBeenCalledTimes(1);
    expect(JSON.parse(lastLine(errorSpy))).toMatchObject({ level: 'error', msg: 'e' });
  });

  it('redacts sensitive keys recursively, through nested objects and arrays', () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => undefined);

    createLogger().info('provider call', {
      apiToken: 'top-secret-token',
      Authorization: 'Bearer abc',
      nested: {
        STRIPE_SECRET_KEY: 'sk_live_123',
        PADDLE_API_KEY: 'not-a-real-key-redaction-fixture',
        PADDLE_WEBHOOK_SECRET: 'pdl_ntfset_789',
        api_key: 'k-123',
        safe: 'keep-me',
        deeper: [{ cookie: 'session=abc' }, { PASSWORD: 'hunter2' }],
      },
    });

    const line = lastLine(warnSpy);
    expect(line).not.toContain('top-secret-token');
    expect(line).not.toContain('Bearer abc');
    expect(line).not.toContain('sk_live_123');
    expect(line).not.toContain('pdl_live_apikey_456');
    expect(line).not.toContain('pdl_ntfset_789');
    expect(line).not.toContain('k-123');
    expect(line).not.toContain('session=abc');
    expect(line).not.toContain('hunter2');

    const record = JSON.parse(line) as {
      apiToken: string;
      Authorization: string;
      nested: {
        STRIPE_SECRET_KEY: string;
        PADDLE_API_KEY: string;
        PADDLE_WEBHOOK_SECRET: string;
        api_key: string;
        safe: string;
        deeper: [{ cookie: string }, { PASSWORD: string }];
      };
    };
    expect(record.apiToken).toBe('[REDACTED]');
    expect(record.Authorization).toBe('[REDACTED]');
    expect(record.nested.STRIPE_SECRET_KEY).toBe('[REDACTED]');
    expect(record.nested.PADDLE_API_KEY).toBe('[REDACTED]');
    expect(record.nested.PADDLE_WEBHOOK_SECRET).toBe('[REDACTED]');
    expect(record.nested.api_key).toBe('[REDACTED]');
    expect(record.nested.safe).toBe('keep-me');
    expect(record.nested.deeper[0].cookie).toBe('[REDACTED]');
    expect(record.nested.deeper[1].PASSWORD).toBe('[REDACTED]');
  });

  it('child() merges bindings, later keys win, and the parent is unchanged', () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const parent = createLogger({ request_id: 'req-1', component: 'ingestion' });
    const child = parent.child({ organization_id: 'org-1', component: 'matching' });

    child.info('scored');
    expect(JSON.parse(lastLine(warnSpy))).toMatchObject({
      request_id: 'req-1',
      organization_id: 'org-1',
      component: 'matching',
    });

    parent.info('parent line');
    const parentRecord = JSON.parse(lastLine(warnSpy)) as Record<string, unknown>;
    expect(parentRecord['component']).toBe('ingestion');
    expect(parentRecord['organization_id']).toBeUndefined();
  });

  it('never throws on hostile fields (circular references, errors, bigints)', () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const circular: Record<string, unknown> = { name: 'loop' };
    circular['self'] = circular;

    expect(() =>
      createLogger().info('hostile', {
        circular,
        failure: new Error('boom'),
        big: 9007199254740993n,
      }),
    ).not.toThrow();

    const record = JSON.parse(lastLine(warnSpy)) as {
      circular: { self: string };
      failure: { name: string; message: string };
      big: string;
    };
    expect(record.circular.self).toBe('[Circular]');
    expect(record.failure).toMatchObject({ name: 'Error', message: 'boom' });
    expect(record.big).toBe('9007199254740993');
  });

  it('never throws when a field getter or proxy throws (SEC-P2-01)', () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const throwingGetter = Object.defineProperty({}, 'value', {
      enumerable: true,
      get() {
        throw new Error('hostile getter');
      },
    });
    const hostileProxy = new Proxy(
      {},
      {
        ownKeys() {
          throw new Error('hostile proxy');
        },
      },
    );

    expect(() => createLogger().info('hostile getter', { throwingGetter })).not.toThrow();
    let record = JSON.parse(lastLine(warnSpy)) as Record<string, unknown>;
    expect(record['msg']).toBe('hostile getter');
    expect(String(record['logger_error'])).toContain('hostile getter');

    expect(() => createLogger().info('hostile proxy', { hostileProxy })).not.toThrow();
    record = JSON.parse(lastLine(warnSpy)) as Record<string, unknown>;
    expect(record['msg']).toBe('hostile proxy');
    expect(record['logger_error']).toBeDefined();
  });
});
