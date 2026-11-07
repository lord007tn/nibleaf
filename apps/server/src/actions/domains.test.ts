import { EventEmitter } from 'node:events';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  domain: { findUnique: vi.fn(), findFirst: vi.fn(), create: vi.fn(), update: vi.fn(), updateMany: vi.fn(), delete: vi.fn() },
  transaction: vi.fn(),
  invalidate: vi.fn(),
  dns: { resolveTxt: vi.fn(), resolveCname: vi.fn(), resolve4: vi.fn(), resolve6: vi.fn() },
  cloudflare: vi.fn(() => false),
  /** What the HTTPS handshake does: 'ok', 'timeout', 'refused' or 'badCert'. */
  tls: { outcome: 'ok' as 'ok' | 'timeout' | 'refused' | 'badCert' },
}));

vi.mock('@nibleaf/database', () => ({ prisma: { domain: mocks.domain, $transaction: mocks.transaction } }));
vi.mock('@/env', () => ({ env: { NODE_ENV: 'production', CUSTOM_DOMAIN_CNAME_TARGET: 'cname.nibleaf.test', APP_URL: 'https://app.nibleaf.test' } }));
vi.mock('node:dns/promises', () => mocks.dns);
vi.mock('node:tls', () => ({
  connect: () => {
    const socket = Object.assign(new EventEmitter(), { authorized: mocks.tls.outcome === 'ok', destroy: vi.fn() });
    setTimeout(() => {
      const outcome = mocks.tls.outcome;
      if (outcome === 'ok') socket.emit('secureConnect');
      else if (outcome === 'timeout') socket.emit('timeout');
      else socket.emit('error', Object.assign(new Error(outcome), { code: outcome === 'refused' ? 'ECONNREFUSED' : 'CERT_HAS_EXPIRED' }));
    }, 0);
    return socket;
  },
}));
vi.mock('./projects', () => ({ assertProjectInOrg: vi.fn() }));
vi.mock('./sites', () => ({ invalidatePublishedSiteConfig: mocks.invalidate }));
vi.mock('@/lib/cloudflare-saas', () => ({
  cloudflareSaasEnabled: mocks.cloudflare,
  createCustomHostname: vi.fn(),
  createCustomHostnameRoute: vi.fn(),
  customHostnameRecords: vi.fn(() => []),
  customHostnameState: vi.fn(),
  deleteCustomHostname: vi.fn(),
  deleteCustomHostnameRoute: vi.fn(),
  getCustomHostname: vi.fn(),
  retryCustomHostname: vi.fn(),
}));

import { addDomain, deleteDomain, setPrimaryDomain, verifyDomain } from './domains';

const row = {
  id: 'domain-1',
  projectId: 'site-1',
  domain: 'docs.example.com',
  verificationToken: 'token',
  provider: 'INGRESS',
  providerHostnameId: null,
  providerData: null,
  verified: true,
  verifiedAt: new Date('2026-10-01T00:00:00Z'),
  isPrimary: true,
  dnsStatus: 'VERIFIED',
  sslStatus: 'ACTIVE',
};

const updates = () => mocks.domain.update.mock.calls.map(([args]) => (args as { data: Record<string, unknown> }).data);
const dnsError = (code: string) => Object.assign(new Error(code), { code });
/** The domain points straight at this instance, at a public address. */
const routed = () => {
  mocks.dns.resolveCname.mockResolvedValue(['cname.nibleaf.test']);
  mocks.dns.resolve4.mockResolvedValue(['93.184.216.34']);
};

beforeEach(() => {
  vi.clearAllMocks();
  mocks.domain.findFirst.mockResolvedValue(row);
  mocks.domain.update.mockImplementation(async ({ data }: { data: Record<string, unknown> }) => ({ ...row, ...data }));
  mocks.dns.resolveTxt.mockResolvedValue([['nibleaf-verify=token']]);
  mocks.dns.resolveCname.mockResolvedValue([]);
  mocks.dns.resolve4.mockResolvedValue([]);
  mocks.dns.resolve6.mockResolvedValue([]);
  mocks.tls.outcome = 'ok';
});

describe('addDomain', () => {
  it('says the domain is already on this site, not that it is taken', async () => {
    mocks.domain.findUnique.mockResolvedValue({ projectId: 'site-1' });
    await expect(addDomain('org-1', 'site-1', { domain: 'docs.example.com' })).rejects.toMatchObject({ code: 'domain:already_added', status: 409 });
  });

  it('reports a domain connected to another site without naming that site', async () => {
    mocks.domain.findUnique.mockResolvedValue({ projectId: 'site-2' });
    const error = await addDomain('org-1', 'site-1', { domain: 'docs.example.com' }).catch((caught: unknown) => caught);
    expect(error).toMatchObject({ code: 'domain:taken', status: 409 });
    expect(JSON.stringify(error)).not.toContain('site-2');
  });

  it('turns a lost race on the unique index into the same "taken" answer', async () => {
    mocks.domain.findUnique.mockResolvedValue(null);
    mocks.domain.create.mockRejectedValue(Object.assign(new Error('Unique constraint failed'), { code: 'P2002' }));
    await expect(addDomain('org-1', 'site-1', { domain: 'docs.example.com' })).rejects.toMatchObject({ code: 'domain:taken' });
  });
});

describe('verifyDomain keeps readers off a primary domain that stopped working', () => {
  it('demotes the primary when the ownership record is gone, and says so', async () => {
    mocks.dns.resolveTxt.mockRejectedValue(dnsError('ENODATA'));
    await expect(verifyDomain('org-1', 'site-1', 'domain-1')).rejects.toMatchObject({
      code: 'domain:ownership_missing',
      status: 422,
      details: expect.objectContaining({ demoted: true }),
    });
    expect(updates()).toContainEqual(expect.objectContaining({ dnsStatus: 'ERROR', isPrimary: false }));
    expect(mocks.invalidate).toHaveBeenCalledWith('site-1');
  });

  it('demotes the primary when the domain no longer points here', async () => {
    await expect(verifyDomain('org-1', 'site-1', 'domain-1')).rejects.toMatchObject({
      code: 'domain:not_pointed',
      status: 422,
      details: expect.objectContaining({ demoted: true }),
    });
    expect(updates()).toContainEqual(expect.objectContaining({ dnsStatus: 'ERROR', isPrimary: false }));
    expect(mocks.invalidate).toHaveBeenCalledWith('site-1');
  });

  it('demotes the primary when routing works but HTTPS does not', async () => {
    mocks.dns.resolveCname.mockResolvedValue(['cname.nibleaf.test']);
    // No public address to probe, so the certificate check fails.
    const result = await verifyDomain('org-1', 'site-1', 'domain-1');
    expect(result).toMatchObject({ sslStatus: 'ERROR', isPrimary: false, demoted: true });
    expect(mocks.invalidate).toHaveBeenCalledWith('site-1');
  });
});

describe('verifyDomain never demotes on a check that could not reach DNS or the site', () => {
  const expectUntouched = () => {
    // Only the check time is written: no status, and the main address stays.
    for (const data of updates()) expect(Object.keys(data)).toEqual(['lastCheckedAt']);
  };

  it.each(['ETIMEOUT', 'ESERVFAIL', 'ECONNREFUSED'])('a TXT lookup failing with %s', async (code) => {
    mocks.dns.resolveTxt.mockRejectedValue(dnsError(code));
    await expect(verifyDomain('org-1', 'site-1', 'domain-1')).rejects.toMatchObject({ code: 'domain:check_inconclusive', status: 503 });
    expectUntouched();
  });

  it.each(['ETIMEOUT', 'ESERVFAIL', 'ECONNREFUSED'])('a CNAME or address lookup failing with %s', async (code) => {
    mocks.dns.resolveCname.mockRejectedValue(dnsError(code));
    mocks.dns.resolve4.mockRejectedValue(dnsError(code));
    await expect(verifyDomain('org-1', 'site-1', 'domain-1')).rejects.toMatchObject({ code: 'domain:check_inconclusive' });
    expect(updates()).not.toContainEqual(expect.objectContaining({ isPrimary: false }));
    expect(updates()).not.toContainEqual(expect.objectContaining({ dnsStatus: 'ERROR' }));
  });

  it.each(['timeout', 'refused'] as const)('an HTTPS check that gets no answer (%s) on a live main address', async (outcome) => {
    routed();
    mocks.tls.outcome = outcome;
    await expect(verifyDomain('org-1', 'site-1', 'domain-1')).rejects.toMatchObject({ code: 'domain:check_inconclusive' });
    expect(updates()).not.toContainEqual(expect.objectContaining({ isPrimary: false }));
    expect(updates()).not.toContainEqual(expect.objectContaining({ sslStatus: 'PROVISIONING' }));
  });

  it('keeps a live main address when the check passes', async () => {
    routed();
    const result = await verifyDomain('org-1', 'site-1', 'domain-1');
    expect(result).toMatchObject({ sslStatus: 'ACTIVE', isPrimary: true, demoted: false });
  });

  it('still demotes on a confirmed certificate problem', async () => {
    routed();
    mocks.tls.outcome = 'badCert';
    await expect(verifyDomain('org-1', 'site-1', 'domain-1')).resolves.toMatchObject({ sslStatus: 'ERROR', isPrimary: false, demoted: true });
  });

  it('reports a new domain whose certificate is not ready yet as being set up, not as an error', async () => {
    mocks.domain.findFirst.mockResolvedValue({ ...row, isPrimary: false, sslStatus: 'PENDING', dnsStatus: 'PENDING' });
    routed();
    mocks.tls.outcome = 'timeout';
    await expect(verifyDomain('org-1', 'site-1', 'domain-1')).resolves.toMatchObject({
      dnsStatus: 'VERIFIED',
      sslStatus: 'PROVISIONING',
      demoted: false,
    });
  });
});

describe('primary and removal', () => {
  it('refuses to make a domain primary before it is live, with a code the dashboard can explain', async () => {
    mocks.domain.findFirst.mockResolvedValue({ ...row, isPrimary: false, sslStatus: 'PROVISIONING' });
    await expect(setPrimaryDomain('org-1', 'site-1', 'domain-1')).rejects.toMatchObject({ code: 'domain:not_ready', status: 409 });
    expect(mocks.transaction).not.toHaveBeenCalled();
  });

  it('stops redirecting to a domain as soon as it is made primary or removed', async () => {
    mocks.domain.findUnique.mockResolvedValue(row);
    await setPrimaryDomain('org-1', 'site-1', 'domain-1');
    expect(mocks.invalidate).toHaveBeenCalledTimes(1);
    await deleteDomain('org-1', 'site-1', 'domain-1');
    expect(mocks.domain.delete).toHaveBeenCalledWith({ where: { id: 'domain-1' } });
    expect(mocks.invalidate).toHaveBeenCalledTimes(2);
  });
});
