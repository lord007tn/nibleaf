/**
 * Pure helpers for resolving the real client IP from proxy headers.
 *
 * Kept free of framework imports so the keying logic is unit-testable: the
 * rate limiter must never collapse every visitor into one shared bucket, so
 * the parsing here has to be right for chained proxies (Traefik → Nitro →
 * API) and for direct socket connections.
 */

const IPV4 = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/;

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
  if (!value.includes(':')) return false;
  try {
    // WHATWG URL parsing validates IPv6, including dotted IPv4-mapped forms,
    // in both the browser and server runtimes that consume this module.
    return /^[0-9a-f:.]+$/i.test(value) && new URL(`http://[${value}]/`).hostname.startsWith('[');
  } catch {
    return false;
  }
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
 * Proxies append their peer address to X-Forwarded-For. The app's Nitro
 * /api proxy forwards this header unchanged (no xfwd option). Leftmost entries
 * can be client-supplied; ingress must sanitize untrusted forwarding headers.
 *
 * First drop trustedHops entries from the right, keeping at least one. The
 * rightmost remaining address is the trust boundary, even for private clients.
 *
 * @param trustedHops Count every address after the client's address, private
 *                    addresses included. Use the same value on app and API.
 *                    Too high can select an attacker-supplied address.
 * See /self-hosting/troubleshooting#readers-see-too-many-requests.
 *
 * Never scan left past a private client into a client-supplied prefix. Null for
 * a missing or unparseable header.
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
  // Everything left of the selected boundary may be client-supplied.
  const candidates = trustedHops > 0 ? hops.slice(0, Math.max(1, hops.length - trustedHops)) : hops;
  return (candidates[candidates.length - 1] as string) ?? null;
};
