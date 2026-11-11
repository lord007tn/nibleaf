import { EventEmitter } from 'node:events';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  domain: { findUnique: vi.fn(), findFirst: vi.fn(), create: vi.fn(), update: vi.fn(), updateMany: vi.fn(), delete: vi.fn() },
  member: { findFirst: vi.fn() },
  transaction: vi.fn(),
  queryRaw: vi.fn(),
  invalidate: vi.fn(),
  dns: { resolveTxt: vi.fn(), resolveCname: vi.fn(), resolve4: vi.fn(), resolve6: vi.fn() },
  cloudflare: vi.fn(() => false),
  /** What the HTTPS handshake does: 'ok', 'timeout', 'refused' or 'badCert'. */
  tls: { outcome: 'ok' as 'ok' | 'timeout' | 'refused' | 'badCert' },
}));

vi.mock('@/lib/access', () => ({ optionalSiteAccess: async () => mocks.member.findFirst() }));
vi.mock('@nibleaf/database', () => ({ prisma: { domain: mocks.domain, member: mocks.member, $transaction: mocks.transaction } }));
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
  mocks.transaction.mockImplementation((write) => write({ domain: mocks.domain, $queryRaw: mocks.queryRaw }));
  mocks.domain.findFirst.mockResolvedValue(row);
  mocks.domain.update.mockImplementation(async ({ data }: { data: Record<string, unknown> }) => ({ ...row, ...data }));
  mocks.dns.resolveTxt.mockResolvedValue([['nibleaf-verify=token']]);
  mocks.dns.resolveCname.mockResolvedValue([]);
  mocks.dns.resolve4.mockResolvedValue([]);
  mocks.dns.resolve6.mockResolvedValue([]);
  mocks.tls.outcome = 'ok';
});

describe('addDomain: a domain that is already connected', () => {
  const add = () => addDomain('org-1', 'site-1', { domain: 'docs.example.com' }, 'user-1').catch((caught: unknown) => caught);
  const heldBy = (projectId: string, name: string, organizationId: string) =>
    mocks.domain.findUnique.mockResolvedValue({ id: 'domain-9', projectId, project: { name, organizationId } });

  it('says it is already on this site', async () => {
    heldBy('site-1', 'Help Center', 'org-1');
    await expect(add()).resolves.toMatchObject({ code: 'domain:already_added', status: 409 });
  });

  it('names the other site when the person adding it is a member of that site', async () => {
    heldBy('site-2', 'Partner Docs', 'org-2');
    mocks.member.findFirst.mockResolvedValue({ id: 'member-1' });
    const error = await add();
    expect(error).toMatchObject({
      code: 'domain:already_connected',
      status: 409,
      details: { domain: 'docs.example.com', scope: 'same_workspace', siteName: 'Partner Docs' },
    });
    expect(mocks.member.findFirst).toHaveBeenCalledOnce();
  });

  it("never reveals another workspace's site or workspace", async () => {
    heldBy('site-3', 'Competitor Secret Docs', 'org-3');
    mocks.member.findFirst.mockResolvedValue(null);
    const error = await add();
    expect(error).toMatchObject({ code: 'domain:already_connected', details: { scope: 'other_workspace' } });
    const sent = JSON.stringify((error as { toJSON: () => unknown }).toJSON());
    expect(sent).not.toContain('Competitor Secret Docs');
    expect(sent).not.toContain('org-3');
    expect(sent).not.toContain('site-3');
  });

  it('gives the same answer when another site wins a race on the unique index', async () => {
    mocks.domain.findUnique.mockResolvedValueOnce(null);
    heldBy('site-3', 'Competitor Secret Docs', 'org-3');
    mocks.member.findFirst.mockResolvedValue(null);
    mocks.domain.create.mockRejectedValue(Object.assign(new Error('Unique constraint failed'), { code: 'P2002' }));
    const error = await add();
    expect(error).toMatchObject({ code: 'domain:already_connected', details: { scope: 'other_workspace' } });
    expect(JSON.stringify(error)).not.toContain('Competitor Secret Docs');
  });
});

describe('verifyDomain keeps readers off a primary domain that stopped working', () => {
  it('asks for the TXT record while a new domain is being set up', async () => {
    mocks.domain.findFirst.mockResolvedValue({
      ...row,
      verified: false,
      verifiedAt: null,
      isPrimary: false,
      dnsStatus: 'PENDING',
      sslStatus: 'PENDING',
    });
    mocks.dns.resolveTxt.mockRejectedValue(dnsError('ENODATA'));
    await expect(verifyDomain('org-1', 'site-1', 'domain-1')).rejects.toMatchObject({
      code: 'domain:ownership_missing',
      status: 422,
      details: expect.objectContaining({ demoted: false }),
    });
    expect(updates()).toContainEqual(expect.objectContaining({ dnsStatus: 'ERROR' }));
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

describe('a verified domain whose TXT record was removed after setup', () => {
  it('stays live and main while routing and HTTPS still work, with a gentle flag', async () => {
    mocks.dns.resolveTxt.mockRejectedValue(dnsError('ENODATA'));
    routed();
    const result = await verifyDomain('org-1', 'site-1', 'domain-1');
    expect(result).toMatchObject({ dnsStatus: 'VERIFIED', sslStatus: 'ACTIVE', isPrimary: true, demoted: false, ownershipRecordMissing: true });
    expect(updates()).not.toContainEqual(expect.objectContaining({ isPrimary: false }));
    expect(updates()).not.toContainEqual(expect.objectContaining({ dnsStatus: 'ERROR' }));
  });

  it('is still demoted when the domain stopped pointing here too', async () => {
    mocks.dns.resolveTxt.mockResolvedValue([]);
    await expect(verifyDomain('org-1', 'site-1', 'domain-1')).rejects.toMatchObject({
      code: 'domain:not_pointed',
      details: expect.objectContaining({ demoted: true }),
    });
  });

  it('does not report the record missing when the TXT lookup simply got no answer', async () => {
    mocks.dns.resolveTxt.mockRejectedValue(dnsError('ETIMEOUT'));
    routed();
    await expect(verifyDomain('org-1', 'site-1', 'domain-1')).resolves.toMatchObject({ isPrimary: true, ownershipRecordMissing: false });
  });
});

describe('verifyDomain never demotes on a check that could not reach DNS or the site', () => {
  const expectUntouched = () => {
    // Only the check time is written: no status, and the main address stays.
    for (const data of updates()) expect(Object.keys(data)).toEqual(['lastCheckedAt']);
  };

  it.each(['ETIMEOUT', 'ESERVFAIL', 'ECONNREFUSED'])('a TXT lookup failing with %s during setup', async (code) => {
    mocks.domain.findFirst.mockResolvedValue({
      ...row,
      verified: false,
      verifiedAt: null,
      isPrimary: false,
      dnsStatus: 'PENDING',
      sslStatus: 'PENDING',
    });
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
    expect(mocks.domain.updateMany).not.toHaveBeenCalled();
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
