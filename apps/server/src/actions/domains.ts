import { resolve4, resolve6, resolveCname, resolveTxt } from 'node:dns/promises';
import { request as httpsRequest } from 'node:https';
import { connect } from 'node:tls';
import { prisma } from '@nibleaf/database';
import { newToken } from '@nibleaf/shared/ids';
import type { AddDomainBody } from '@nibleaf/validators';
import { env } from '@/env';
import { badRequest, conflict, notFound } from '@/errors';
import { type DomainDnsSnapshot, hasOwnershipRecord, isPublicAddress, normalizeDnsName, pointsAtTarget } from '@/lib/domain-checks';
import { assertProjectInOrg } from './projects';

/** The host a custom domain should CNAME to. Prefer an explicit target, else the
 *  instance's own base domain — never a SaaS host the self-hoster doesn't own. */
const cnameTarget = (): string => normalizeDnsName(env.CUSTOM_DOMAIN_CNAME_TARGET || env.SITE_BASE_DOMAIN || new URL(env.APP_URL).host);

/** DNS records the user must create to point a custom domain at Nibleaf. */
export const dnsRecords = (domain: Domain) => [
  { type: 'CNAME', name: domain.domain, value: cnameTarget(), ttl: 3600 },
  { type: 'TXT', name: `_nibleaf.${domain.domain}`, value: `nibleaf-verify=${domain.verificationToken}`, ttl: 3600 },
];

interface Domain {
  domain: string;
  verificationToken: string;
}

export const listDomains = async (projectId: string) => {
  const domains = await prisma.domain.findMany({ where: { projectId }, orderBy: { createdAt: 'asc' } });
  return domains.map((domain) => ({ ...domain, records: dnsRecords(domain) }));
};

export const addDomain = async (organizationId: string, projectId: string, body: AddDomainBody) => {
  await assertProjectInOrg(organizationId, projectId);
  const domain = body.domain.toLowerCase();
  const existing = await prisma.domain.findUnique({ where: { domain }, select: { id: true } });
  if (existing) {
    throw conflict('That domain is already connected.', { domain });
  }
  const created = await prisma.domain.create({ data: { projectId, domain, verificationToken: newToken(24) } });
  return { ...created, records: dnsRecords(created) };
};

const resolveAddresses = async (host: string): Promise<string[]> => {
  const [v4, v6] = await Promise.all([resolve4(host).catch(() => [] as string[]), resolve6(host).catch(() => [] as string[])]);
  return [...new Set([...v4, ...v6])];
};

const inspectDns = async (domain: string): Promise<DomainDnsSnapshot> => {
  const target = cnameTarget();
  const [txt, cnames, addresses, targetAddresses] = await Promise.all([
    resolveTxt(`_nibleaf.${domain}`).catch(() => [] as string[][]),
    resolveCname(domain).catch(() => [] as string[]),
    resolveAddresses(domain),
    resolveAddresses(target),
  ]);
  return { txt, cnames, addresses, targetAddresses };
};

const probeTls = async (domain: string, addresses: string[]): Promise<{ status: 'ACTIVE' | 'PROVISIONING' | 'ERROR'; error: string | null }> => {
  const address = addresses.find(isPublicAddress);
  if (!address) {
    return { status: 'ERROR', error: 'DNS resolves to an unsafe or unreachable address.' };
  }
  return new Promise((resolve) => {
    const socket = connect({ host: address, port: 443, servername: domain, rejectUnauthorized: true, timeout: 12_000 });
    let settled = false;
    const finish = (result: { status: 'ACTIVE' | 'PROVISIONING' | 'ERROR'; error: string | null }) => {
      if (settled) return;
      settled = true;
      socket.destroy();
      resolve(result);
    };
    socket.once('secureConnect', () =>
      finish({ status: socket.authorized ? 'ACTIVE' : 'ERROR', error: socket.authorized ? null : 'TLS certificate is not valid for this domain.' }),
    );
    socket.once('timeout', () => finish({ status: 'PROVISIONING', error: 'TLS provisioning timed out. Retry in a minute.' }));
    socket.once('error', (error) => {
      const code = (error as NodeJS.ErrnoException).code ?? '';
      const certificateError = /CERT|TLS|VERIFY|SELF_SIGNED/.test(code);
      finish({
        status: certificateError ? 'ERROR' : 'PROVISIONING',
        error: certificateError
          ? 'The server presented an invalid certificate for this domain.'
          : 'TLS is still provisioning. Retry after DNS has propagated.',
      });
    });
  });
};

/** Confirm a proxied hostname still reaches this Nibleaf instance. Cloudflare
 * hides the original CNAME, so address comparison alone cannot prove routing. */
const probeRoute = async (domain: string, addresses: string[], projectId: string): Promise<boolean> => {
  const address = addresses.find(isPublicAddress);
  if (!address) return false;
  return new Promise((resolve) => {
    let body = '';
    let settled = false;
    const finish = (result: boolean) => {
      if (settled) return;
      settled = true;
      request.destroy();
      resolve(result);
    };
    const request = httpsRequest(
      {
        hostname: domain,
        port: 443,
        path: `/api/public/domains/resolve?host=${encodeURIComponent(domain)}`,
        method: 'GET',
        servername: domain,
        timeout: 12_000,
        lookup: (_hostname, _options, callback) => callback(null, address, address.includes(':') ? 6 : 4),
        headers: { accept: 'application/json' },
      },
      (response) => {
        if (response.statusCode !== 200) return finish(false);
        response.setEncoding('utf8');
        response.on('data', (chunk: string) => {
          body += chunk;
          if (body.length > 16_384) finish(false);
        });
        response.once('end', () => {
          try {
            const parsed = JSON.parse(body) as { data?: { projectId?: string | null } };
            finish(parsed.data?.projectId === projectId);
          } catch {
            finish(false);
          }
        });
      },
    );
    request.once('timeout', () => finish(false));
    request.once('error', () => finish(false));
    request.end();
  });
};

/**
 * Verify ownership by checking the DNS TXT record.
 *
 * Ownership, routing, and TLS are checked independently and persisted so the UI
 * can explain exactly what is ready and what the owner needs to fix. Marking the
 * domain verified before the TLS probe is intentional: Caddy's on-demand `ask`
 * endpoint must see the verified row before the first certificate handshake.
 */
export const verifyDomain = async (organizationId: string, projectId: string, id: string) => {
  await assertProjectInOrg(organizationId, projectId);
  const domain = await prisma.domain.findFirst({ where: { id, projectId } });
  if (!domain) {
    throw notFound('domain', { id });
  }

  if (env.NODE_ENV !== 'production') {
    return prisma.domain.update({
      where: { id },
      data: {
        verified: true,
        verifiedAt: domain.verifiedAt ?? new Date(),
        dnsStatus: 'VERIFIED',
        sslStatus: 'ACTIVE',
        lastCheckedAt: new Date(),
        lastError: null,
      },
    });
  }

  const checkedAt = new Date();
  const snapshot = await inspectDns(domain.domain);
  if (!hasOwnershipRecord(snapshot.txt, domain.verificationToken)) {
    const message = `Ownership TXT record is missing. Add the exact _nibleaf.${domain.domain} record shown below, then retry.`;
    await prisma.domain.update({ where: { id }, data: { dnsStatus: 'ERROR', sslStatus: 'PENDING', lastCheckedAt: checkedAt, lastError: message } });
    throw badRequest(message, { domain: domain.domain, stage: 'ownership' });
  }

  await prisma.domain.update({
    where: { id },
    data: { verified: true, verifiedAt: domain.verifiedAt ?? checkedAt, lastCheckedAt: checkedAt },
  });

  const directTarget = pointsAtTarget(snapshot, cnameTarget());
  const earlyTls = directTarget ? null : await probeTls(domain.domain, snapshot.addresses);
  const proxiedTarget = earlyTls?.status === 'ACTIVE' && (await probeRoute(domain.domain, snapshot.addresses, projectId));
  if (!(directTarget || proxiedTarget)) {
    const message = `Ownership is verified, but ${domain.domain} does not point to ${cnameTarget()}. Update the CNAME record and retry.`;
    await prisma.domain.update({
      where: { id },
      data: { dnsStatus: 'ERROR', sslStatus: earlyTls?.status ?? 'PENDING', lastError: message },
    });
    throw badRequest(message, { domain: domain.domain, stage: 'routing' });
  }

  await prisma.domain.update({ where: { id }, data: { dnsStatus: 'VERIFIED', sslStatus: 'PROVISIONING', lastError: null } });
  const tls = earlyTls ?? (await probeTls(domain.domain, snapshot.addresses));
  return prisma.domain.update({
    where: { id },
    data: {
      sslStatus: tls.status,
      lastCheckedAt: new Date(),
      lastError: tls.error,
    },
  });
};

export const setPrimaryDomain = async (organizationId: string, projectId: string, id: string) => {
  await assertProjectInOrg(organizationId, projectId);
  const domain = await prisma.domain.findFirst({ where: { id, projectId } });
  if (!domain) {
    throw notFound('domain', { id });
  }
  if (!(domain.verified && domain.dnsStatus === 'VERIFIED' && domain.sslStatus === 'ACTIVE')) {
    throw badRequest('DNS and TLS must both be active before making this domain primary.', { id, domain: domain.domain });
  }
  await prisma.$transaction([
    prisma.domain.updateMany({ where: { projectId }, data: { isPrimary: false } }),
    prisma.domain.update({ where: { id }, data: { isPrimary: true } }),
  ]);
  return prisma.domain.findUnique({ where: { id } });
};

export const deleteDomain = async (organizationId: string, projectId: string, id: string) => {
  await assertProjectInOrg(organizationId, projectId);
  const domain = await prisma.domain.findFirst({ where: { id, projectId }, select: { id: true } });
  if (!domain) {
    throw notFound('domain', { id });
  }
  await prisma.domain.delete({ where: { id } });
  return { id };
};
