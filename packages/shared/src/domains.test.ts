import { describe, expect, it } from 'vitest';
import { isDomainLive, pickLiveDomain } from './domains';

const live = { verified: true, dnsStatus: 'VERIFIED', sslStatus: 'ACTIVE' };
const row = (domain: string, patch: Partial<typeof live & { isPrimary: boolean }> = {}) => ({ domain, isPrimary: false, ...live, ...patch });

describe('isDomainLive', () => {
  it('needs ownership, DNS and HTTPS together', () => {
    expect(isDomainLive(live)).toBe(true);
    expect(isDomainLive({ ...live, verified: false })).toBe(false);
    expect(isDomainLive({ ...live, dnsStatus: 'ERROR' })).toBe(false);
    expect(isDomainLive({ ...live, sslStatus: 'PROVISIONING' })).toBe(false);
  });
});

describe('pickLiveDomain', () => {
  it('prefers the live primary over an older live domain', () => {
    expect(pickLiveDomain([row('old.example.com'), row('main.example.com', { isPrimary: true })])?.domain).toBe('main.example.com');
  });

  it('skips a primary that verified ownership but does not serve yet, for the oldest live domain', () => {
    const domains = [
      row('broken.example.com', { isPrimary: true, dnsStatus: 'ERROR' }),
      row('securing.example.com', { sslStatus: 'PROVISIONING' }),
      row('first-live.example.com'),
      row('second-live.example.com'),
    ];
    expect(pickLiveDomain(domains)?.domain).toBe('first-live.example.com');
  });

  it('returns nothing when no domain is live', () => {
    expect(pickLiveDomain([row('a.example.com', { sslStatus: 'ERROR' })])).toBeUndefined();
    expect(pickLiveDomain([])).toBeUndefined();
  });
});
