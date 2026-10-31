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

it.each([
  '0.0.0.0',
  '10.1.2.3',
  '100.64.0.1',
  '100.127.255.255',
  '127.0.0.1',
  '169.254.169.254',
  '168.63.129.16',
  '172.31.255.255',
  '192.0.0.1',
  '192.0.2.1',
  '192.168.1.1',
  '198.18.0.1',
  '198.51.100.1',
  '203.0.113.1',
  '224.0.0.1',
  '240.0.0.1',
  '255.255.255.255',
  '::',
  '::1',
  'fc00::1',
  'fd00::1',
  'fe80::1',
  'febf::1',
  'ff02::1',
  '::ffff:127.0.0.1',
  '::ffff:7f00:1',
  '0:0:0:0:0:ffff:a00:1',
  '::192.168.1.1',
  '::a00:1',
  '2001:db8::1',
  '2001::1',
  '2002:7f00:1::',
  '3fff::1',
  'not-an-ip',
])('rejects non-public address %s', (address) => expect(isPublicAddress(address)).toBe(false));

it.each(['1.1.1.1', '8.8.8.8', '100.128.0.1', '172.32.0.1', '2606:4700:4700::1111', '::ffff:808:808', '::8.8.8.8'])(
  'accepts public address %s',
  (address) => expect(isPublicAddress(address)).toBe(true),
);
