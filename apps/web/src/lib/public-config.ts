/**
 * Public runtime config (GET /api/public-config — unauthenticated,
 * secret-free): the pre-launch gate state, the countdown target, and the
 * Paddle.js client-side token + environment (`paddle` is `null` when
 * billing is not configured, e.g. local/test — a Paddle client token is
 * public by Paddle's design; the server-side API key never reaches here).
 * Fetched once per page load and cached module-wide; on any failure the
 * SPA assumes the OPEN state so a config hiccup can never hide the
 * product — the server gates are the real enforcement.
 */
import { useEffect, useState } from 'react';

export interface PaddlePublicConfig {
  readonly clientToken: string;
  readonly environment: 'sandbox' | 'production';
}

export interface PublicConfig {
  readonly prelaunch: boolean;
  readonly launchDate: string;
  readonly paddle: PaddlePublicConfig | null;
}

const OPEN_FALLBACK: PublicConfig = {
  prelaunch: false,
  launchDate: '2026-08-31T21:00:00Z',
  paddle: null,
};

let cached: PublicConfig | null = null;
let inflight: Promise<PublicConfig> | null = null;

function parsePaddle(value: unknown): PaddlePublicConfig | null {
  if (typeof value !== 'object' || value === null) return null;
  const v = value as { clientToken?: unknown; environment?: unknown };
  if (typeof v.clientToken !== 'string' || v.clientToken.length === 0) return null;
  if (v.environment !== 'sandbox' && v.environment !== 'production') return null;
  return { clientToken: v.clientToken, environment: v.environment };
}

async function fetchPublicConfig(): Promise<PublicConfig> {
  try {
    const response = await fetch('/api/public-config');
    if (!response.ok) return OPEN_FALLBACK;
    const body = (await response.json()) as Partial<PublicConfig> & { paddle?: unknown };
    if (typeof body.prelaunch !== 'boolean' || typeof body.launchDate !== 'string') {
      return OPEN_FALLBACK;
    }
    return {
      prelaunch: body.prelaunch,
      launchDate: body.launchDate,
      paddle: parsePaddle(body.paddle),
    };
  } catch {
    return OPEN_FALLBACK;
  }
}

/** Non-hook reader for the same cached config (e.g. lib/paddle.ts). */
export function getPublicConfig(): Promise<PublicConfig> {
  if (cached !== null) return Promise.resolve(cached);
  inflight ??= fetchPublicConfig().then((resolved) => {
    cached = resolved;
    return resolved;
  });
  return inflight;
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
    void getPublicConfig().then((resolved) => {
      if (!cancelled) setConfig(resolved);
    });
    return () => {
      cancelled = true;
    };
  }, []);
  return config;
}
