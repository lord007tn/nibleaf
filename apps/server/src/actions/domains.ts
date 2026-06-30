import { resolveTxt } from 'node:dns/promises';
import { prisma } from '@midad/database';
import { newToken } from '@midad/shared/ids';
import type { AddDomainBody } from '@midad/validators';
import { env } from '@/env';
import { badRequest, conflict, notFound } from '@/errors';
import { assertProjectInOrg } from './projects';

export const listDomains = (projectId: string) => prisma.domain.findMany({ where: { projectId }, orderBy: { createdAt: 'asc' } });

/** DNS records the user must create to point a custom domain at Midad. */
export const dnsRecords = (domain: Domain) => [
  { type: 'CNAME', name: domain.domain, value: env.CUSTOM_DOMAIN_CNAME_TARGET, ttl: 3600 },
  { type: 'TXT', name: `_midad.${domain.domain}`, value: `midad-verify=${domain.verificationToken}`, ttl: 3600 },
];

interface Domain {
  domain: string;
  verificationToken: string;
}

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

/**
 * Verify ownership by checking the DNS TXT record.
 *
 * In production we resolve `_midad.<domain>` and require a record containing the
 * project's verification token. In non-production we bypass the lookup so local
 * testing (where DNS isn't configured) still works.
 */
export const verifyDomain = async (organizationId: string, projectId: string, id: string) => {
  await assertProjectInOrg(organizationId, projectId);
  const domain = await prisma.domain.findFirst({ where: { id, projectId } });
  if (!domain) {
    throw notFound('domain', { id });
  }

  if (env.NODE_ENV === 'production') {
    const expected = `midad-verify=${domain.verificationToken}`;
    const records = await resolveTxt(`_midad.${domain.domain}`).catch(() => [] as string[][]);
    const verified = records.some((chunks) => chunks.join('').includes(expected));
    if (!verified) {
      throw badRequest('DNS TXT record not found yet — add the record and retry.');
    }
  }

  return prisma.domain.update({ where: { id }, data: { verified: true, verifiedAt: new Date() } });
};

export const setPrimaryDomain = async (organizationId: string, projectId: string, id: string) => {
  await assertProjectInOrg(organizationId, projectId);
  const domain = await prisma.domain.findFirst({ where: { id, projectId } });
  if (!domain) {
    throw notFound('domain', { id });
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
