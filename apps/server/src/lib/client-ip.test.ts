import { describe, expect, it } from 'vitest';
import { clientIpFromForwardedFor, isPrivateIp, isValidIp, normalizeIp } from './client-ip';

describe('normalizeIp', () => {
  it('strips an IPv4 port suffix', () => {
    expect(normalizeIp('203.0.113.7:5301')).toBe('203.0.113.7');
  });
  it('strips brackets (and port) from IPv6', () => {
    expect(normalizeIp('[2001:db8::1]')).toBe('2001:db8::1');
    expect(normalizeIp('[2001:db8::1]:8080')).toBe('2001:db8::1');
  });
  it('does not mangle bare IPv6 (colons are not ports)', () => {
    expect(normalizeIp('2001:db8::1')).toBe('2001:db8::1');
  });
  it('strips an IPv6 zone id', () => {
    expect(normalizeIp('fe80::1%eth0')).toBe('fe80::1');
  });
  it('trims and lowercases', () => {
    expect(normalizeIp('  2001:DB8::A ')).toBe('2001:db8::a');
  });
});

describe('isValidIp', () => {
  it('accepts real addresses and rejects garbage', () => {
    expect(isValidIp('203.0.113.7')).toBe(true);
    expect(isValidIp('2001:db8::1')).toBe(true);
    expect(isValidIp('999.1.1.1')).toBe(false);
    expect(isValidIp('not-an-ip')).toBe(false);
    expect(isValidIp('')).toBe(false);
  });
});

describe('isPrivateIp', () => {
  it('flags RFC1918, loopback, link-local and CGNAT ranges', () => {
    for (const ip of ['10.0.0.1', '172.16.0.1', '172.31.255.255', '192.168.1.1', '127.0.0.1', '169.254.0.5', '100.64.0.1']) {
      expect(isPrivateIp(ip), ip).toBe(true);
    }
  });
  it('flags private IPv6 (loopback, ULA, link-local, v4-mapped)', () => {
    for (const ip of ['::1', 'fc00::1', 'fd12::1', 'fe80::1', '::ffff:10.0.0.1']) {
      expect(isPrivateIp(ip), ip).toBe(true);
    }
  });
  it('does not flag public addresses', () => {
    for (const ip of ['203.0.113.7', '8.8.8.8', '172.32.0.1', '2001:db8::1', '::ffff:203.0.113.7']) {
      expect(isPrivateIp(ip), ip).toBe(false);
    }
  });
});

describe('clientIpFromForwardedFor', () => {
  it('returns null for a missing or empty header (never a shared constant)', () => {
    expect(clientIpFromForwardedFor(undefined)).toBeNull();
    expect(clientIpFromForwardedFor(null)).toBeNull();
    expect(clientIpFromForwardedFor('')).toBeNull();
    expect(clientIpFromForwardedFor('unknown')).toBeNull();
    expect(clientIpFromForwardedFor('garbage, more garbage')).toBeNull();
  });
  it('returns the single hop when there is only one', () => {
    expect(clientIpFromForwardedFor('203.0.113.7')).toBe('203.0.113.7');
  });
  it('takes the RIGHTMOST public hop, skipping our own private proxy hops', () => {
    // Traefik → nitro proxy → API: the real client is the rightmost public hop.
    expect(clientIpFromForwardedFor('203.0.113.7, 10.0.0.5, 172.18.0.2')).toBe('203.0.113.7');
  });
  it('IGNORES a client-spoofed leftmost hop (proxies append, so the left is attacker-controlled)', () => {
    // Attacker sends "X-Forwarded-For: 9.9.9.9"; nginx appends the real peer.
    expect(clientIpFromForwardedFor('9.9.9.9, 203.0.113.7')).toBe('203.0.113.7');
    // Rotating spoofed values must not mint new buckets.
    expect(clientIpFromForwardedFor('1.1.1.1, 2.2.2.2, 203.0.113.7')).toBe('203.0.113.7');
  });
  it('drops trustedHops public edge hops (e.g. Cloudflare) before choosing', () => {
    // client, cloudflare-edge → with trustedHops=1 the CF address is not the client.
    expect(clientIpFromForwardedFor('203.0.113.7, 198.51.100.9', 1)).toBe('203.0.113.7');
    // Spoof + client + CF edge: still the real client.
    expect(clientIpFromForwardedFor('9.9.9.9, 203.0.113.7, 198.51.100.9', 1)).toBe('203.0.113.7');
    // Never slices away every hop.
    expect(clientIpFromForwardedFor('203.0.113.7', 3)).toBe('203.0.113.7');
  });
  it('falls back to the rightmost hop when every hop is private (internal deployments still get per-caller buckets)', () => {
    expect(clientIpFromForwardedFor('10.0.0.5, 172.18.0.2')).toBe('172.18.0.2');
  });
  it('normalizes ports and brackets before matching', () => {
    expect(clientIpFromForwardedFor('203.0.113.7:5301')).toBe('203.0.113.7');
    expect(clientIpFromForwardedFor('[2001:db8::1]:443, 10.0.0.1')).toBe('2001:db8::1');
  });
  it('skips invalid hops without giving up on the rest', () => {
    expect(clientIpFromForwardedFor('203.0.113.7, unknown')).toBe('203.0.113.7');
  });
});
