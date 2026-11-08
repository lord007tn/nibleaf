import { describe, expect, it } from 'vitest';
import { clientIpFromForwardedFor, isValidIp } from './client-ip';

describe('proxy hop compatibility used by app and API', () => {
  it.each([
    ['9.9.9.9, 203.0.113.7, 198.51.100.9', 1, '203.0.113.7'],
    ['9.9.9.9, 203.0.113.7, 198.51.100.9, 198.51.100.10', 2, '203.0.113.7'],
    ['9.9.9.9, 203.0.113.7, 198.51.100.9, 172.17.0.1', 2, '203.0.113.7'],
    ['9.9.9.9, 203.0.113.7, 198.51.100.9, 172.17.0.1', 1, '198.51.100.9'],
    ['203.0.113.7, 172.17.0.1, 10.0.0.1', 2, '203.0.113.7'],
    ['10.0.0.2, 172.17.0.1', 0, '172.17.0.1'],
    ['9.9.9.9, ::ffff:203.0.113.7, 172.17.0.1', 1, '::ffff:203.0.113.7'],
    ['9.9.9.9, 10.0.0.7, 172.17.0.1', 1, '10.0.0.7'],
    ['9.9.9.9, 203.0.113.7, 198.51.100.9, 172.17.0.1', 3, '9.9.9.9'],
  ])('%s with %i trusted hops selects %s', (chain, count, expected) => {
    expect(clientIpFromForwardedFor(chain, count)).toBe(expected);
  });
  it.each(['2001::db8::1', '1:2:3', '::ffff:999.1.1.1'])('rejects malformed IPv6 %s', (value) => {
    expect(isValidIp(value)).toBe(false);
  });
  it.each(['2001:db8::1', '::1', '::ffff:203.0.113.7'])('accepts IPv6 %s', (value) => {
    expect(isValidIp(value)).toBe(true);
  });
});
