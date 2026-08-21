/**
 * Public runtime config (GET /api/public-config — unauthenticated,
 * secret-free): the pre-launch gate state and the countdown target.
 * Fetched once per page load and cached module-wide; on any failure the
 * SPA assumes the OPEN state so a config hiccup can never hide the
 * product — the server gates are the real enforcement.
 */
import { useEffect, useState } from 'react';

export interface PublicConfig {
  readonly prelaunch: boolean;
  readonly launchDate: string;
}

const OPEN_FALLBACK: PublicConfig = { prelaunch: false, launchDate: '2026-08-31T21:00:00Z' };

let cached: PublicConfig | null = null;
let inflight: Promise<PublicConfig> | null = null;

async function fetchPublicConfig(): Promise<PublicConfig> {
  try {
    const response = await fetch('/api/public-config');
    if (!response.ok) return OPEN_FALLBACK;
    const body = (await response.json()) as Partial<PublicConfig>;
    if (typeof body.prelaunch !== 'boolean' || typeof body.launchDate !== 'string') {
      return OPEN_FALLBACK;
    }
    return { prelaunch: body.prelaunch, launchDate: body.launchDate };
  } catch {
    return OPEN_FALLBACK;
  }
}

/**
 * Null while loading (callers render the open state), then the resolved
 * config. Cached: only the first caller per page load hits the network.
 */
export function usePublicConfig(): PublicConfig | null {
  const [config, setConfig] = useState<PublicConfig | null>(cached);
  useEffect(() => {
    if (cached !== null) return;
    let cancelled = false;
    inflight ??= fetchPublicConfig().then((resolved) => {
      cached = resolved;
      return resolved;
    });
    void inflight.then((resolved) => {
      if (!cancelled) setConfig(resolved);
    });
    return () => {
      cancelled = true;
    };
  }, []);
  return config;
}
