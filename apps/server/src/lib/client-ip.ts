/**
 * Pure helpers for resolving the real client IP from proxy headers.
 *
 * Kept free of framework imports so the keying logic is unit-testable: the
 * rate limiter must never collapse every visitor into one shared bucket, so
 * the parsing here has to be right for chained proxies (Traefik → Nitro →
 * API) and for direct socket connections.
 */

const IPV4 = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/;

/** Loose IPv6 shape check — hex groups and colons (after brackets/zone are stripped). */
const IPV6 = /^[0-9a-f:]+$/i;

/** Strip an optional `[...]` wrapper, a `:port` suffix (IPv4 only — IPv6 colons
 *  are ambiguous without brackets) and a `%zone` id from a forwarded hop. */
export const normalizeIp = (raw: string): string => {
  let value = raw.trim().toLowerCase();
  // `[::1]:8080` → `::1`
  const bracketed = /^\[([^\]]+)\](?::\d+)?$/.exec(value);
  if (bracketed?.[1]) {
    value = bracketed[1];
  } else if (/^\d{1,3}(\.\d{1,3}){3}:\d+$/.test(value)) {
    // `1.2.3.4:5678` → `1.2.3.4`
    value = value.slice(0, value.lastIndexOf(':'));
  }
  // `fe80::1%eth0` → `fe80::1`
  const zone = value.indexOf('%');
  return zone === -1 ? value : value.slice(0, zone);
};

export const isValidIp = (value: string): boolean => {
  const v4 = IPV4.exec(value);
  if (v4) {
    return v4.slice(1).every((octet) => Number(octet) <= 255);
  }
  return value.includes(':') && IPV6.test(value);
};

/** Private / reserved ranges that can never be a real public client: loopback,
 *  RFC1918, link-local, CGNAT, and their IPv6 equivalents (incl. v4-mapped). */
export const isPrivateIp = (ip: string): boolean => {
  const value = ip.startsWith('::ffff:') ? ip.slice(7) : ip;
  const v4 = IPV4.exec(value);
  if (v4) {
    const [a, b] = [Number(v4[1]), Number(v4[2])];
    return (
      a === 10 ||
      a === 127 ||
      a === 0 ||
      (a === 172 && b >= 16 && b <= 31) ||
      (a === 192 && b === 168) ||
      (a === 169 && b === 254) ||
      (a === 100 && b >= 64 && b <= 127)
    );
  }
  return value === '::1' || value === '::' || value.startsWith('fc') || value.startsWith('fd') || value.startsWith('fe80');
};

/**
 * Resolve the client IP from an `x-forwarded-for` chain using RIGHTMOST-UNTRUSTED
 * parsing.
 *
 * `X-Forwarded-For` is APPENDED to by each proxy (nginx's
 * `$proxy_add_x_forwarded_for`, Traefik, our own nitro `/api` proxy), so a client
 * can send `X-Forwarded-For: 9.9.9.9` and the API sees `9.9.9.9, <real client>,
 * <proxy>`. The LEFTMOST hops are therefore attacker-controlled: trusting them
 * lets one visitor mint a fresh rate-limit bucket per request. Only hops appended
 * by infrastructure we run are trustworthy, and those are the RIGHTMOST ones.
 *
 * We scan right-to-left, skipping the hops our own proxies added (private-network
 * addresses, plus `trustedHops` extra public ones for an edge like Cloudflare),
 * and take the first remaining address. Anything a client injected sits further
 * left and is ignored.
 *
 * @param trustedHops number of PUBLIC proxy hops appended by edge infrastructure
 *                    you operate (e.g. 1 behind Cloudflare). Private hops are
 *                    always skipped and need not be counted.
 *
 * When every remaining hop is private (an internal-only deployment) the rightmost
 * one is used so callers still get per-caller buckets. Null for a missing or
 * unparseable header.
 */
export const clientIpFromForwardedFor = (header: string | null | undefined, trustedHops = 0): string | null => {
  if (!header) {
    return null;
  }
  const hops = header
    .split(',')
    .map((hop) => normalizeIp(hop))
    .filter((hop) => hop.length > 0 && hop !== 'unknown' && isValidIp(hop));
  if (hops.length === 0) {
    return null;
  }
  // Drop the public edge hops we operate, then walk right-to-left past our own
  // private proxy hops. Everything still further left is client-supplied.
  const candidates = trustedHops > 0 ? hops.slice(0, Math.max(1, hops.length - trustedHops)) : hops;
  for (let i = candidates.length - 1; i >= 0; i--) {
    const hop = candidates[i] as string;
    if (!isPrivateIp(hop)) {
      return hop;
    }
  }
  return (candidates[candidates.length - 1] as string) ?? null;
};
