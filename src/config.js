// -----------------------------------------------------------------------------
// The configuration of the manifest `config_schema`, normalized.
// -----------------------------------------------------------------------------

import { LIMITS, OPEN_API, POLL_INTERVAL } from './constants.js';

/** Defaults, mirrored by the manifest (checked by test/manifest.test.js). */
export const DEFAULTS = {
  addresses: '',
  poll_interval: POLL_INTERVAL.default,
};

const HOST =
  /^(?:\d{1,3}(?:\.\d{1,3}){3}|[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?)*)$/i;

function parseAddress(token) {
  const match = /^([^:]+)(?::(\d{1,5}))?$/.exec(token);
  if (!match || !HOST.test(match[1])) {
    return undefined;
  }
  const host = match[1].toLowerCase();
  if (/^\d+(?:\.\d+){3}$/.test(host) && host.split('.').some((n) => Number(n) > 255)) {
    return undefined;
  }
  const port = match[2] === undefined ? OPEN_API.defaultPort : Number(match[2]);
  if (port < 1 || port > 65535) {
    return undefined;
  }
  return { host, port };
}

/**
 * "192.168.1.40, 192.168.1.41:30001" -> the batteries typed by the user.
 * @returns {{ addresses: { host: string, port: number }[], invalid: string[] }}
 */
export function parseAddresses(raw) {
  const addresses = [];
  const invalid = [];
  const seen = new Set();
  for (const token of String(raw ?? '')
    .split(/[\s,;]+/)
    .filter(Boolean)) {
    const address = parseAddress(token);
    if (!address) {
      invalid.push(token);
      continue;
    }
    const key = `${address.host}:${address.port}`;
    if (!seen.has(key) && addresses.length < LIMITS.batteries) {
      seen.add(key);
      addresses.push(address);
    }
  }
  return { addresses, invalid };
}

export function normalizeConfig(raw = {}) {
  const given = Object.fromEntries(
    Object.entries(raw ?? {}).filter(([, v]) => v !== null && v !== undefined),
  );
  const c = { ...DEFAULTS, ...given };
  const { addresses, invalid } = parseAddresses(c.addresses);
  const interval = Number(c.poll_interval);
  return {
    addresses,
    invalidAddresses: invalid,
    pollInterval: Number.isFinite(interval)
      ? Math.max(POLL_INTERVAL.min, Math.min(POLL_INTERVAL.max, Math.round(interval)))
      : POLL_INTERVAL.default,
  };
}
