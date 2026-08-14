/**
 * Foundational structured logger.
 *
 * Emits single-line JSON records. The lint policy allows only `console.warn`
 * and `console.error`, so `error`-level records go to `console.error` and
 * everything else to `console.warn` — Workers logs capture both streams.
 *
 * Redaction: any field key matching the sensitive-key pattern is replaced
 * with "[REDACTED]", recursively through nested objects and arrays, before
 * serialization. Logging must never throw and never leak a secret.
 */

export type LogLevel = 'debug' | 'info' | 'warn' | 'error';

export type LogFields = Readonly<Record<string, unknown>>;

/**
 * Well-known correlation-ID binding keys. Attach them via `child()` at the
 * start of a request / queue message / cron run so every subsequent line
 * carries the correlation context.
 */
export interface CorrelationBindings {
  readonly request_id?: string;
  readonly organization_id?: string;
  readonly ingestion_run_id?: string;
  readonly notice_id?: string;
  readonly lot_id?: string;
  readonly digest_run_id?: string;
  readonly billing_event_id?: string;
}

export interface Logger {
  debug(msg: string, fields?: LogFields): void;
  info(msg: string, fields?: LogFields): void;
  warn(msg: string, fields?: LogFields): void;
  error(msg: string, fields?: LogFields): void;
  /** New logger with merged bindings; later keys win. Parent is unchanged. */
  child(bindings: LogFields): Logger;
}

const REDACTED = '[REDACTED]';
const SENSITIVE_KEY_PATTERN = /password|token|secret|authorization|apikey|api_key|cookie/i;

/**
 * Recursively sanitize a value for logging: redact sensitive keys, make
 * Errors and Dates serializable, and guard against circular references.
 */
function sanitize(value: unknown, seen: WeakSet<object>): unknown {
  if (value === null || value === undefined) {
    return value;
  }
  const kind = typeof value;
  if (kind === 'string' || kind === 'number' || kind === 'boolean') {
    return value;
  }
  if (kind === 'bigint') {
    return String(value);
  }
  if (value instanceof Date) {
    return value.toISOString();
  }
  if (value instanceof Error) {
    return {
      name: value.name,
      message: value.message,
      stack: value.stack,
    };
  }
  if (Array.isArray(value)) {
    if (seen.has(value)) {
      return '[Circular]';
    }
    seen.add(value);
    const out = value.map((item) => sanitize(item, seen));
    seen.delete(value);
    return out;
  }
  if (kind === 'object') {
    const source = value as Record<string, unknown>;
    if (seen.has(source)) {
      return '[Circular]';
    }
    seen.add(source);
    const out: Record<string, unknown> = {};
    for (const [key, item] of Object.entries(source)) {
      out[key] = SENSITIVE_KEY_PATTERN.test(key) ? REDACTED : sanitize(item, seen);
    }
    seen.delete(source);
    return out;
  }
  // functions, symbols — represent, never throw
  return String(value);
}

function emit(level: LogLevel, msg: string, bindings: LogFields, fields: LogFields | undefined) {
  const ts = new Date().toISOString();

  let line: string;
  try {
    // The spread and sanitize can both be made to throw by hostile inputs
    // (throwing getters, Proxies), so the never-throw guarantee must cover
    // them, not only JSON.stringify.
    const merged = sanitize({ ...bindings, ...(fields ?? {}) }, new WeakSet()) as Record<
      string,
      unknown
    >;
    line = JSON.stringify({ ts, level, msg, ...merged });
  } catch (cause) {
    // Never throw from the logger; fall back to a minimal, safe record.
    line = JSON.stringify({ ts, level, msg, logger_error: String(cause) });
  }

  if (level === 'error') {
    console.error(line);
  } else {
    console.warn(line);
  }
}

export function createLogger(bindings: LogFields = {}): Logger {
  return {
    debug(msg, fields) {
      emit('debug', msg, bindings, fields);
    },
    info(msg, fields) {
      emit('info', msg, bindings, fields);
    },
    warn(msg, fields) {
      emit('warn', msg, bindings, fields);
    },
    error(msg, fields) {
      emit('error', msg, bindings, fields);
    },
    child(childBindings) {
      return createLogger({ ...bindings, ...childBindings });
    },
  };
}
