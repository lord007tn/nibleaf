import { resolve4, resolve6, resolveCname, resolveTxt } from 'node:dns/promises';
import { request as httpsRequest } from 'node:https';
import { connect } from 'node:tls';
import { prisma } from '@nibleaf/database';
import { isDomainLive } from '@nibleaf/shared/domains';
import { newToken } from '@nibleaf/shared/ids';
import type { AddDomainBody } from '@nibleaf/validators';
import { env } from '@/env';
import { AppError, notFound } from '@/errors';
import { optionalSiteAccess } from '@/lib/access';
import {
  type CloudflareCustomHostname,
  cloudflareSaasEnabled,
  createCustomHostname,
  createCustomHostnameRoute,
  customHostnameRecords,
  customHostnameState,
  deleteCustomHostname,
  deleteCustomHostnameRoute,
  getCustomHostname,
  retryCustomHostname,
} from '@/lib/cloudflare-saas';
import { type DomainDnsSnapshot, hasOwnershipRecord, isPublicAddress, normalizeDnsName, pointsAtTarget } from '@/lib/domain-checks';
import { assertProjectInOrg } from './projects';
import { invalidatePublishedSiteConfig } from './sites';

/** A domain failure the dashboard can explain in plain words: the `code` picks the
 * localized message, and `message` stays as technical detail for support. */
const domainError = (
  code:
    | 'domain:already_added'
    | 'domain:already_connected'
    | 'domain:provider_failed'
    | 'domain:ownership_missing'
    | 'domain:not_pointed'
    | 'domain:not_ready'
    | 'domain:check_inconclusive',
  message: string,
  details: Record<string, unknown>,
) => new AppError({ code, message, details });

const providerMessage = (error: unknown) => (error instanceof Error ? error.message : 'Unknown provider error.');

const isUniqueViolation = (error: unknown) => (error as { code?: unknown } | null)?.code === 'P2002';

/** The host a custom domain should CNAME to. Prefer an explicit target, else the
 *  instance's own base domain — never a SaaS host the self-hoster doesn't own. */
const cnameTarget = (): string => normalizeDnsName(env.CUSTOM_DOMAIN_CNAME_TARGET || env.SITE_BASE_DOMAIN || new URL(env.APP_URL).host);

/** DNS records the user must create to point a custom domain at Nibleaf. */
const dnsRecords = (domain: Domain) =>
  domain.provider === 'CLOUDFLARE_SAAS' && domain.providerData
    ? customHostnameRecords(domain.providerData as unknown as CloudflareCustomHostname, cnameTarget())
    : [
        { type: 'CNAME' as const, name: domain.domain, value: cnameTarget(), ttl: 3600 },
        { type: 'TXT' as const, name: `_nibleaf.${domain.domain}`, value: `nibleaf-verify=${domain.verificationToken}`, ttl: 3600 },
      ];

interface Domain {
  domain: string;
  verificationToken: string;
  provider: string;
  providerData?: unknown;
}

export const listDomains = async (projectId: string) => {
  const domains = await prisma.domain.findMany({ where: { projectId }, orderBy: { createdAt: 'asc' } });
  return domains.map((domain) => ({ ...domain, records: dnsRecords(domain) }));
};

/**
 * Why `domain` can't be added: it is on this site already, or on another one.
 * Each site is its own workspace (organization), so "same workspace" means a site
 * the person adding the domain is a member of: one they can already open, so its
 * name tells them nothing new. For any other site, neither its name nor its
 * workspace is revealed.
 */
const alreadyConnected = async (domain: string, projectId: string, userId: string) => {
  const holder = await prisma.domain.findUnique({
    where: { domain },
    select: { projectId: true, project: { select: { name: true, organizationId: true } } },
  });
  if (holder?.projectId === projectId) return domainError('domain:already_added', 'That domain is already connected to this site.', { domain });
  const member = holder ? await optionalSiteAccess(userId, holder.projectId) : null;
  return holder && member
    ? domainError('domain:already_connected', 'That domain is already connected to another of your sites.', {
        domain,
        scope: 'same_workspace',
        siteName: holder.project.name,
      })
    : domainError('domain:already_connected', 'That domain is already connected to another workspace.', { domain, scope: 'other_workspace' });
};

export const addDomain = async (organizationId: string, projectId: string, body: AddDomainBody, userId: string) => {
  await assertProjectInOrg(organizationId, projectId);
  const domain = body.domain.toLowerCase();
  const existing = await prisma.domain.findUnique({ where: { domain }, select: { id: true } });
  if (existing) {
    throw await alreadyConnected(domain, projectId, userId);
  }
  if (cloudflareSaasEnabled()) {
    let provisioned: CloudflareCustomHostname | null = null;
    let routeId: string | null = null;
    try {
      provisioned = await createCustomHostname(domain);
      const route = await createCustomHostnameRoute(domain);
      routeId = route.id;
      provisioned = { ...provisioned, nibleafWorkerRouteId: route.id };
    } catch (error) {
      if (routeId) await deleteCustomHostnameRoute(routeId).catch(() => undefined);
      if (provisioned) await deleteCustomHostname(provisioned.id).catch(() => undefined);
      throw domainError('domain:provider_failed', `Cloudflare could not provision ${domain}: ${providerMessage(error)}`, {
        domain,
        stage: 'provisioning',
      });
    }
    if (!provisioned) throw domainError('domain:provider_failed', 'Cloudflare returned no custom hostname.', { domain, stage: 'provisioning' });
    const state = customHostnameState(provisioned);
    try {
      const created = await prisma.domain.create({
        data: {
          projectId,
          domain,
          verificationToken: newToken(24),
          provider: 'CLOUDFLARE_SAAS',
          providerHostnameId: provisioned.id,
          providerData: provisioned as never,
          ...state,
          verifiedAt: state.verified ? new Date() : null,
          lastCheckedAt: new Date(),
        },
      });
      return { ...created, records: dnsRecords(created) };
    } catch (error) {
      if (routeId) await deleteCustomHostnameRoute(routeId).catch(() => undefined);
      await deleteCustomHostname(provisioned.id).catch(() => undefined);
      if (isUniqueViolation(error)) throw await alreadyConnected(domain, projectId, userId);
      throw error;
    }
  }

  try {
    const created = await prisma.domain.create({ data: { projectId, domain, verificationToken: newToken(24), provider: 'INGRESS' } });
    return { ...created, records: dnsRecords(created) };
  } catch (error) {
    // Two sites adding the same address at once: the unique index decides.
    if (isUniqueViolation(error)) throw await alreadyConnected(domain, projectId, userId);
    throw error;
  }
};

/** The resolver answered that the name or record does not exist. Anything else
 *  (`ETIMEOUT`, `ESERVFAIL`, `ECONNREFUSED`, …) means DNS could not be asked. */
const CONFIRMED_MISS = new Set(['ENODATA', 'ENOTFOUND']);

interface Lookup<T> {
  value: T;
  /** The lookup failed for a reason that says nothing about the records. */
  inconclusive: boolean;
}

const lookup = async <T>(query: () => Promise<T>, empty: T): Promise<Lookup<T>> => {
  try {
    return { value: await query(), inconclusive: false };
  } catch (error) {
    return { value: empty, inconclusive: !CONFIRMED_MISS.has((error as NodeJS.ErrnoException).code ?? '') };
  }
};

const resolveAddresses = async (host: string): Promise<Lookup<string[]>> => {
  const [v4, v6] = await Promise.all([lookup(() => resolve4(host), [] as string[]), lookup(() => resolve6(host), [] as string[])]);
  // One family missing is normal; only an address list with an unanswered family is in doubt.
  return { value: [...new Set([...v4.value, ...v6.value])], inconclusive: v4.inconclusive || v6.inconclusive };
};

interface DnsInspection {
  snapshot: DomainDnsSnapshot;
  ownershipInconclusive: boolean;
  routingInconclusive: boolean;
}

const inspectDns = async (domain: string): Promise<DnsInspection> => {
  const target = cnameTarget();
  const [txt, cnames, addresses, targetAddresses] = await Promise.all([
    lookup(() => resolveTxt(`_nibleaf.${domain}`), [] as string[][]),
    lookup(() => resolveCname(domain), [] as string[]),
    resolveAddresses(domain),
    resolveAddresses(target),
  ]);
  return {
    snapshot: { txt: txt.value, cnames: cnames.value, addresses: addresses.value, targetAddresses: targetAddresses.value },
    ownershipInconclusive: txt.inconclusive,
    routingInconclusive: cnames.inconclusive || addresses.inconclusive || targetAddresses.inconclusive,
  };
};

interface TlsProbe {
  status: 'ACTIVE' | 'PROVISIONING' | 'ERROR';
  error: string | null;
  /** No answer (timeout, refused or reset connection): proves neither way. */
  inconclusive: boolean;
}

const probeTls = async (domain: string, addresses: string[]): Promise<TlsProbe> => {
  const address = addresses.find(isPublicAddress);
  if (!address) {
    return { status: 'ERROR', error: 'DNS resolves to an unsafe or unreachable address.', inconclusive: false };
  }
  return new Promise((resolve) => {
    const socket = connect({ host: address, port: 443, servername: domain, rejectUnauthorized: true, timeout: 12_000 });
    let settled = false;
    const finish = (result: TlsProbe) => {
      if (settled) return;
      settled = true;
      socket.destroy();
      resolve(result);
    };
    socket.once('secureConnect', () =>
      finish({
        status: socket.authorized ? 'ACTIVE' : 'ERROR',
        error: socket.authorized ? null : 'TLS certificate is not valid for this domain.',
        inconclusive: false,
      }),
    );
    socket.once('timeout', () => finish({ status: 'PROVISIONING', error: 'TLS provisioning timed out. Retry in a minute.', inconclusive: true }));
    socket.once('error', (error) => {
      const code = (error as NodeJS.ErrnoException).code ?? '';
      const certificateError = /CERT|TLS|VERIFY|SELF_SIGNED/.test(code);
      finish(
        certificateError
          ? { status: 'ERROR', error: 'The server presented an invalid certificate for this domain.', inconclusive: false }
          : { status: 'PROVISIONING', error: 'TLS is still provisioning. Retry after DNS has propagated.', inconclusive: true },
      );
    });
  });
};

/** Confirm a proxied hostname still reaches this Nibleaf instance. Cloudflare
 * hides the original CNAME, so address comparison alone cannot prove routing. */
const probeRoute = async (domain: string, addresses: string[], projectId: string): Promise<'yes' | 'no' | 'unknown'> => {
  const address = addresses.find(isPublicAddress);
  if (!address) return 'no';
  return new Promise((resolve) => {
    let body = '';
    let settled = false;
    const finish = (result: 'yes' | 'no' | 'unknown') => {
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
        if (response.statusCode !== 200) return finish('no');
        response.setEncoding('utf8');
        response.on('data', (chunk: string) => {
          body += chunk;
          if (body.length > 16_384) finish('no');
        });
        response.once('end', () => {
          try {
            const parsed = JSON.parse(body) as { data?: { projectId?: string | null } };
            finish(parsed.data?.projectId === projectId ? 'yes' : 'no');
          } catch {
            finish('no');
          }
        });
      },
    );
    request.once('timeout', () => finish('unknown'));
    request.once('error', () => finish('unknown'));
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
 *
 * Only a domain whose routing and TLS both work may stay primary: the primary is
 * the canonical host every other address 301s to, so a check that confirms a
 * problem demotes it (readers fall back to the site's default address) until it
 * is fixed and made primary again; the result, or the error's details, then
 * carry `demoted: true`. A check that could not reach DNS or the site (resolver
 * timeout or failure, TLS timeout, refused connection) proves nothing: it changes
 * no status and never demotes, and answers `domain:check_inconclusive`.
 *
 * The TXT record proves ownership once. Many owners delete verification records
 * after setup, so for a domain verified before, a missing TXT record is not a
 * failure: routing and HTTPS decide, and the result says
 * `ownershipRecordMissing: true` so the dashboard can suggest adding it back.
 */
export const verifyDomain = async (organizationId: string, projectId: string, id: string) => {
  await assertProjectInOrg(organizationId, projectId);
  try {
    return await checkDomain(projectId, id);
  } finally {
    // The primary may have been demoted; stop redirecting to it on this replica now.
    invalidatePublishedSiteConfig(projectId);
  }
};

const checkDomain = async (projectId: string, id: string) => {
  const domain = await prisma.domain.findFirst({ where: { id, projectId } });
  if (!domain) {
    throw notFound('domain', { id });
  }

  if (domain.provider === 'CLOUDFLARE_SAAS') {
    if (!domain.providerHostnameId) {
      throw domainError('domain:provider_failed', 'This domain is missing its Cloudflare hostname identifier. Remove it and add it again.', {
        id,
        stage: 'provisioning',
      });
    }
    let current: CloudflareCustomHostname;
    try {
      current = await getCustomHostname(domain.providerHostnameId);
      if (current.status !== 'active' || current.ssl?.status !== 'active') {
        current = await retryCustomHostname(domain.providerHostnameId);
      }
    } catch (error) {
      // Not reaching the provider says nothing about the domain itself, so its status (and primary) stay.
      const message = `Cloudflare status could not be refreshed: ${providerMessage(error)}`;
      await prisma.domain.update({ where: { id }, data: { lastCheckedAt: new Date(), lastError: message } });
      throw domainError('domain:provider_failed', message, { domain: domain.domain, stage: 'provider' });
    }
    const state = customHostnameState(current);
    const updated = await prisma.domain.update({
      where: { id },
      data: {
        ...state,
        providerData: {
          ...current,
          nibleafWorkerRouteId: (domain.providerData as { nibleafWorkerRouteId?: string } | null)?.nibleafWorkerRouteId,
        } as never,
        verifiedAt: state.verified ? (domain.verifiedAt ?? new Date()) : null,
        isPrimary: state.verified ? domain.isPrimary : false,
        lastCheckedAt: new Date(),
      },
    });
    return { ...updated, demoted: domain.isPrimary && !state.verified };
  }

  if (env.NODE_ENV !== 'production') {
    const updated = await prisma.domain.update({
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
    return { ...updated, demoted: false };
  }

  const checkedAt = new Date();
  const wasLive = isDomainLive(domain);
  const wasPrimary = domain.isPrimary;
  // Only the check time is recorded: the stored status is still the best answer we have.
  const inconclusive = async (stage: string, message: string): Promise<never> => {
    await prisma.domain.update({ where: { id }, data: { lastCheckedAt: checkedAt } });
    throw domainError('domain:check_inconclusive', message, { domain: domain.domain, stage });
  };

  const { snapshot, ownershipInconclusive, routingInconclusive } = await inspectDns(domain.domain);
  const ownershipRecordMissing = !hasOwnershipRecord(snapshot.txt, domain.verificationToken);
  if (ownershipRecordMissing && !domain.verified) {
    if (ownershipInconclusive) return inconclusive('ownership', `DNS did not answer for _nibleaf.${domain.domain}. Retry in a few minutes.`);
    const message = `Ownership TXT record is missing. Add the exact _nibleaf.${domain.domain} record shown below, then retry.`;
    await prisma.domain.update({
      where: { id },
      data: { dnsStatus: 'ERROR', sslStatus: 'PENDING', isPrimary: false, lastCheckedAt: checkedAt, lastError: message },
    });
    throw domainError('domain:ownership_missing', message, { domain: domain.domain, stage: 'ownership', demoted: wasPrimary });
  }

  await prisma.domain.update({
    where: { id },
    data: { verified: true, verifiedAt: domain.verifiedAt ?? checkedAt, lastCheckedAt: checkedAt },
  });

  const directTarget = pointsAtTarget(snapshot, cnameTarget());
  const earlyTls = directTarget ? null : await probeTls(domain.domain, snapshot.addresses);
  const proxied = earlyTls?.status === 'ACTIVE' ? await probeRoute(domain.domain, snapshot.addresses, projectId) : 'no';
  if (!(directTarget || proxied === 'yes')) {
    if (routingInconclusive || earlyTls?.inconclusive || proxied === 'unknown') {
      return inconclusive('routing', `Could not confirm where ${domain.domain} points: DNS or the site did not answer. Retry in a few minutes.`);
    }
    const message = `Ownership is verified, but ${domain.domain} does not point to ${cnameTarget()}. Update the CNAME record and retry.`;
    await prisma.domain.update({
      where: { id },
      data: { dnsStatus: 'ERROR', sslStatus: earlyTls?.status ?? 'PENDING', isPrimary: false, lastError: message },
    });
    throw domainError('domain:not_pointed', message, { domain: domain.domain, stage: 'routing', demoted: wasPrimary });
  }

  // A live domain keeps showing as live while its certificate is re-checked.
  if (!wasLive) await prisma.domain.update({ where: { id }, data: { dnsStatus: 'VERIFIED', sslStatus: 'PROVISIONING', lastError: null } });
  const tls = earlyTls ?? (await probeTls(domain.domain, snapshot.addresses));
  // Without every address answered, a failed handshake may be the missing address, not the certificate.
  const tlsInconclusive = tls.inconclusive || (tls.status !== 'ACTIVE' && routingInconclusive);
  if (tlsInconclusive && wasLive) {
    return inconclusive('tls', `The HTTPS check for ${domain.domain} got no answer. Retry in a few minutes.`);
  }
  // Still being set up (not live before) is not a failure; only a confirmed certificate problem demotes.
  const demote = tls.status === 'ERROR' && !tlsInconclusive;
  const updated = await prisma.domain.update({
    where: { id },
    data: {
      dnsStatus: 'VERIFIED',
      sslStatus: tlsInconclusive ? 'PROVISIONING' : tls.status,
      ...(demote ? { isPrimary: false } : {}),
      lastCheckedAt: new Date(),
      lastError: tls.error,
    },
  });
  // Only a confirmed absence: a TXT lookup that got no answer says nothing about the record.
  return { ...updated, demoted: demote && wasPrimary, ownershipRecordMissing: ownershipRecordMissing && !ownershipInconclusive };
};

export const setPrimaryDomain = async (organizationId: string, projectId: string, id: string) => {
  await assertProjectInOrg(organizationId, projectId);
  const domain = await prisma.domain.findFirst({ where: { id, projectId } });
  if (!domain) {
    throw notFound('domain', { id });
  }
  if (!(domain.verified && domain.dnsStatus === 'VERIFIED' && domain.sslStatus === 'ACTIVE')) {
    throw domainError('domain:not_ready', 'DNS and TLS must both be active before making this domain primary.', { id, domain: domain.domain });
  }
  await prisma.$transaction([
    prisma.domain.updateMany({ where: { projectId }, data: { isPrimary: false } }),
    prisma.domain.update({ where: { id }, data: { isPrimary: true } }),
  ]);
  invalidatePublishedSiteConfig(projectId);
  return prisma.domain.findUnique({ where: { id } });
};

export const deleteDomain = async (organizationId: string, projectId: string, id: string) => {
  await assertProjectInOrg(organizationId, projectId);
  const domain = await prisma.domain.findFirst({ where: { id, projectId }, select: { id: true, provider: true, providerHostnameId: true } });
  if (!domain) {
    throw notFound('domain', { id });
  }
  if (domain.provider === 'CLOUDFLARE_SAAS' && domain.providerHostnameId) {
    try {
      const stored = await prisma.domain.findUnique({ where: { id }, select: { providerData: true } });
      const routeId = (stored?.providerData as { nibleafWorkerRouteId?: string } | null)?.nibleafWorkerRouteId;
      if (routeId) await deleteCustomHostnameRoute(routeId);
      await deleteCustomHostname(domain.providerHostnameId);
    } catch (error) {
      throw domainError('domain:provider_failed', `Cloudflare could not remove this hostname: ${providerMessage(error)}`, {
        id,
        stage: 'provider',
      });
    }
  }
  await prisma.domain.delete({ where: { id } });
  // A removed primary must stop being the redirect target at once.
  invalidatePublishedSiteConfig(projectId);
  return { id };
};
