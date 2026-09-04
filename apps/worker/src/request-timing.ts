/**
 * Per-request timing for the API (ADR-0012).
 *
 * Two consumers:
 *
 * 1. Every request ends with a structured `request completed` log line
 *    carrying the matched route pattern, status, wall time and the
 *    Cloudflare colo/country the Worker ran in. With Workers Logs enabled
 *    (wrangler.jsonc `observability`) that is the customer-geography latency
 *    measurement: real EU traffic, queried by colo in the dashboard, instead
 *    of a probe from a GitHub runner on another continent.
 * 2. Outside production the same numbers are echoed as a `Server-Timing`
 *    header so `scripts/measure-api-latency.mjs` can split its wall-clock
 *    figure into "Worker-side" and "network to the runner". Production never
 *    sends it: precise server-side timings are a side channel for nothing
 *    a customer needs (docs/threat-model.md).
 *
 * Wall time is `Date.now()` at entry vs. exit. In Workers the clock only
 * advances across I/O, so the figure is the request's real elapsed time as
 * the runtime sees it, D1 round trips included, and never a CPU-precise
 * timer.
 */

/** Cloudflare colo identifiers are three-letter IATA codes. */
const COLO_PATTERN = /^[A-Z]{3}$/;
/** ISO 3166-1 alpha-2, plus Cloudflare's `T1` for Tor exits. */
const COUNTRY_PATTERN = /^[A-Z0-9]{2}$/;
/** Cloudflare continent codes: AF, AN, AS, EU, NA, OC, SA. */
const CONTINENT_PATTERN = /^[A-Z]{2}$/;

export interface RequestPlacement {
  readonly colo: string;
  readonly country: string;
  /**
   * Continent of the colo the Worker ran in. The latency script uses it to
   * tell a European vantage (the customers' path to the WEUR database)
   * from any other, where every D1 round trip crosses an ocean.
   */
  readonly continent: string;
}

/**
 * Read where the Worker ran from `request.cf`. The properties are supplied
 * by the platform, but they are still validated before they reach a
 * response header or a log line: an unexpected shape becomes `unknown`.
 */
export function readPlacement(cf: unknown): RequestPlacement {
  const record = typeof cf === 'object' && cf !== null ? (cf as Record<string, unknown>) : {};
  const colo =
    typeof record['colo'] === 'string' && COLO_PATTERN.test(record['colo'])
      ? record['colo']
      : 'unknown';
  const country =
    typeof record['country'] === 'string' && COUNTRY_PATTERN.test(record['country'])
      ? record['country']
      : 'unknown';
  const continent =
    typeof record['continent'] === 'string' && CONTINENT_PATTERN.test(record['continent'])
      ? record['continent']
      : 'unknown';
  return { colo, country, continent };
}

/**
 * `Server-Timing` value for a completed request, or `null` when the
 * environment must not expose one (production).
 */
export function serverTimingHeader(
  appEnv: string,
  durationMs: number,
  placement: RequestPlacement,
): string | null {
  if (appEnv === 'production') {
    return null;
  }
  const duration = Number.isFinite(durationMs) && durationMs >= 0 ? Math.round(durationMs) : 0;
  return `app;dur=${String(duration)}, colo;desc="${placement.colo}", continent;desc="${placement.continent}"`;
}
