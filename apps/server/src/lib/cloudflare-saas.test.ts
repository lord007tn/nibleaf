import { describe, expect, it } from 'vitest';
import { customHostnameRecords, customHostnameState } from './cloudflare-saas-state';

describe('Cloudflare for SaaS hostname normalization', () => {
  it('exposes routing, ownership, and certificate validation records without duplicates', () => {
    const records = customHostnameRecords(
      {
        id: 'hostname-id',
        hostname: 'docs.customer.com',
        ownership_verification: { type: 'txt', name: '_cf-custom-hostname.docs.customer.com', value: 'ownership-token' },
        ssl: { validation_records: [{ txt_name: '_acme-challenge.docs.customer.com', txt_value: 'dcv-token' }] },
      },
      'cname.nibleaf.com',
    );
    expect(records).toEqual([
      { type: 'CNAME', name: 'docs.customer.com', value: 'cname.nibleaf.com', ttl: 3600 },
      { type: 'TXT', name: '_cf-custom-hostname.docs.customer.com', value: 'ownership-token', ttl: 3600 },
      { type: 'TXT', name: '_acme-challenge.docs.customer.com', value: 'dcv-token', ttl: 3600 },
    ]);
  });

  it('marks a domain verified only when hostname routing and edge TLS are active', () => {
    expect(customHostnameState({ id: 'id', hostname: 'docs.customer.com', status: 'active', ssl: { status: 'active' } })).toMatchObject({
      verified: true,
      dnsStatus: 'VERIFIED',
      sslStatus: 'ACTIVE',
    });
    expect(customHostnameState({ id: 'id', hostname: 'docs.customer.com', status: 'pending', ssl: { status: 'pending_validation' } })).toMatchObject({
      verified: false,
      dnsStatus: 'PENDING',
      sslStatus: 'PROVISIONING',
    });
  });
});
