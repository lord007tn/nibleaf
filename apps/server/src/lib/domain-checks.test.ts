import { describe, expect, it } from 'vitest';
import { hasOwnershipRecord, isPublicAddress, normalizeDnsName, pointsAtTarget } from './domain-checks';

describe('domain checks', () => {
  it('normalizes ingress host values', () => {
    expect(normalizeDnsName(' HTTPS://CNAME.Docs.Example.com:443/path ')).toBe('cname.docs.example.com');
  });

  it('requires an exact ownership record while supporting split TXT chunks', () => {
    expect(hasOwnershipRecord([['nibleaf-verify=', 'abc']], 'abc')).toBe(true);
    expect(hasOwnershipRecord([['prefix nibleaf-verify=abc suffix']], 'abc')).toBe(false);
  });

  it('accepts either the configured CNAME or a shared ingress address', () => {
    expect(pointsAtTarget({ txt: [], cnames: ['edge.example.com.'], addresses: [], targetAddresses: [] }, 'edge.example.com')).toBe(true);
    expect(pointsAtTarget({ txt: [], cnames: [], addresses: ['203.0.113.8'], targetAddresses: ['203.0.113.8'] }, 'edge.example.com')).toBe(true);
    expect(pointsAtTarget({ txt: [], cnames: [], addresses: ['203.0.113.9'], targetAddresses: ['203.0.113.8'] }, 'edge.example.com')).toBe(false);
  });

  it('blocks private probe destinations', () => {
    expect(isPublicAddress('10.0.0.1')).toBe(false);
    expect(isPublicAddress('172.16.4.2')).toBe(false);
    expect(isPublicAddress('192.168.1.1')).toBe(false);
    expect(isPublicAddress('::1')).toBe(false);
    expect(isPublicAddress('2606:4700:4700::1111')).toBe(true);
    expect(isPublicAddress('1.1.1.1')).toBe(true);
  });
});
