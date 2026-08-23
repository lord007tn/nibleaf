import { prisma } from '@nibleaf/database';
import { slugify } from '@nibleaf/shared';
import { env } from '@/env';
import { AppError, notFound } from '@/errors';
import { inviteMember } from './members';
import { getProjectUsage } from './usage';
import { parseWorkspaceMetadata } from './workspace';

const MAX_PROJECT_SLUG_LENGTH = 63;

type InviteOrganizationInput = {
  organizationName: string;
  siteName: string;
  ownerEmail: string;
  siteSlug?: string;
  description?: string;
  delivery: 'email' | 'link';
};

async function uniqueAdminProjectSlug(desired: string): Promise<string> {
  const base = (slugify(desired) || 'docs').slice(0, MAX_PROJECT_SLUG_LENGTH).replace(/-+$/g, '') || 'docs';
  for (let index = 0; index < 100; index++) {
    const suffix = index === 0 ? '' : `-${index + 1}`;
    const candidate = `${base.slice(0, MAX_PROJECT_SLUG_LENGTH - suffix.length).replace(/-+$/g, '')}${suffix}`;
    const clash = await prisma.project.findUnique({ where: { slug: candidate }, select: { id: true } });
    if (!clash) {
      return candidate;
    }
  }
  return `${base.slice(0, 50)}-${Date.now().toString(36)}`;
}

/** Create a site's organization boundary and invite its first owner. The admin
 * remains a platform operator, not a hidden workspace member. */
export async function inviteOrganizationOwner(adminUserId: string, input: InviteOrganizationInput) {
  const ownerEmail = input.ownerEmail.trim().toLowerCase();
  const slug = await uniqueAdminProjectSlug(input.siteSlug || input.siteName);
  const created = await prisma.$transaction(async (tx) => {
    const organization = await tx.organization.create({ data: { name: input.organizationName.trim() } });
    const project = await tx.project.create({
      data: {
        organizationId: organization.id,
        name: input.siteName.trim(),
        slug,
        ...(input.description?.trim() ? { description: input.description.trim() } : {}),
      },
    });
    await tx.language.create({
      data: { projectId: project.id, code: 'en', label: 'English', direction: 'LTR', isDefault: true, position: 0 },
    });
    await tx.branch.create({ data: { projectId: project.id, name: 'main', isDefault: true } });
    return { organization, project };
  });

  try {
    // `bootstrapOwner`: the one sanctioned owner-invitation — this org was
    // created empty above, so accepting it yields exactly one owner.
    const invitation = await inviteMember(
      created.organization.id,
      adminUserId,
      'owner',
      { email: ownerEmail, role: 'owner' },
      { sendEmail: input.delivery === 'email', bootstrapOwner: true },
    );
    return {
      organizationId: created.organization.id,
      projectId: created.project.id,
      invitationId: invitation.id,
      ownerEmail,
      slug: created.project.slug,
      invitationUrl: `${env.APP_URL}/accept-invite/${invitation.id}`,
      delivery: input.delivery,
    };
  } catch (error) {
    // Avoid leaving an ownerless site if invitation creation fails.
    await prisma.organization.delete({ where: { id: created.organization.id } }).catch(() => undefined);
    throw error;
  }
}

/** Platform-wide counts + recent activity for the admin overview screen. */
export async function getAdminOverview() {
  const dayAgo = new Date(Date.now() - 24 * 60 * 60 * 1000);
  const weekAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
  const [
    users,
    admins,
    sites,
    deployments,
    ready,
    recentUsers,
    verifiedUsers,
    suspendedUsers,
    failedDeployments24h,
    activeDeployments,
    domains,
    healthyDomains,
    domainIssues,
    takenDownSites,
    expiredOwnerInvites,
    failedExports7d,
    gitIssues,
  ] = await Promise.all([
    prisma.user.count(),
    prisma.user.count({ where: { role: 'admin' } }),
    prisma.project.count(),
    prisma.deployment.count(),
    prisma.deployment.count({ where: { status: 'READY' } }),
    prisma.user.count({ where: { createdAt: { gte: weekAgo } } }),
    prisma.user.count({ where: { emailVerified: true } }),
    prisma.user.count({ where: { suspendedAt: { not: null } } }),
    prisma.deployment.count({ where: { status: 'FAILED', createdAt: { gte: dayAgo } } }),
    prisma.deployment.count({ where: { status: { in: ['PENDING', 'BUILDING'] } } }),
    prisma.domain.count(),
    prisma.domain.count({ where: { dnsStatus: 'VERIFIED', sslStatus: 'ACTIVE' } }),
    prisma.domain.count({ where: { OR: [{ dnsStatus: 'ERROR' }, { sslStatus: 'ERROR' }] } }),
    prisma.project.count({ where: { takedownAt: { not: null } } }),
    prisma.invitation.count({ where: { role: 'owner', status: 'pending', expiresAt: { lt: new Date() } } }),
    prisma.exportJob.count({ where: { status: 'FAILED', createdAt: { gte: weekAgo } } }),
    prisma.gitConnection.count({ where: { lastSyncStatus: { in: ['FAILED', 'CONFLICT'] } } }),
  ]);
  return {
    users,
    admins,
    sites,
    deployments,
    publishedDeployments: ready,
    recentUsers,
    verifiedUsers,
    suspendedUsers,
    failedDeployments24h,
    activeDeployments,
    domains,
    healthyDomains,
    domainIssues,
    takenDownSites,
    expiredOwnerInvites,
    failedExports7d,
    gitIssues,
  };
}

/** Every user on the instance, newest first, with workspace-membership count. */
export async function listAdminUsers() {
  const now = new Date();
  const users = await prisma.user.findMany({
    select: {
      id: true,
      name: true,
      email: true,
      role: true,
      emailVerified: true,
      suspendedAt: true,
      createdAt: true,
      accounts: { select: { providerId: true } },
      sessions: { orderBy: { updatedAt: 'desc' }, take: 1, select: { updatedAt: true } },
      _count: { select: { members: true, sessions: { where: { expiresAt: { gt: now } } } } },
    },
    orderBy: { createdAt: 'desc' },
    take: 500,
  });
  return users.map((u) => ({
    id: u.id,
    name: u.name,
    email: u.email,
    role: u.role,
    emailVerified: u.emailVerified,
    suspendedAt: u.suspendedAt?.toISOString() ?? null,
    workspaces: u._count.members,
    providers: [...new Set(u.accounts.map((account) => account.providerId))].sort(),
    activeSessions: u._count.sessions,
    lastActiveAt: u.sessions[0]?.updatedAt.toISOString() ?? null,
    createdAt: u.createdAt.toISOString(),
  }));
}

/** One customer account with privacy-minimized authentication, workspace, and
 * activity context. Session tokens, IPs, user agents, content, and event
 * metadata deliberately never cross this boundary. */
export async function getAdminUser(userId: string) {
  const now = new Date();
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: {
      id: true,
      name: true,
      email: true,
      role: true,
      emailVerified: true,
      suspendedAt: true,
      createdAt: true,
      updatedAt: true,
      accounts: { select: { providerId: true, createdAt: true, updatedAt: true } },
      sessions: {
        orderBy: { updatedAt: 'desc' },
        take: 500,
        select: { updatedAt: true, expiresAt: true },
      },
      members: {
        orderBy: { createdAt: 'desc' },
        take: 500,
        select: {
          id: true,
          role: true,
          createdAt: true,
          organization: {
            select: {
              id: true,
              name: true,
              metadata: true,
              projects: {
                orderBy: { createdAt: 'asc' },
                take: 1,
                select: {
                  id: true,
                  name: true,
                  slug: true,
                  takedownAt: true,
                  updatedAt: true,
                  deployments: {
                    orderBy: { createdAt: 'desc' },
                    take: 1,
                    select: { status: true, version: true, createdAt: true, completedAt: true },
                  },
                  domains: { select: { dnsStatus: true, sslStatus: true } },
                },
              },
            },
          },
        },
      },
    },
  });
  if (!user) {
    throw notFound('User', { id: userId });
  }

  const events = await prisma.platformEvent.findMany({
    where: { userId },
    orderBy: { createdAt: 'desc' },
    take: 30,
    select: { id: true, type: true, projectId: true, createdAt: true },
  });
  const projectIds = [...new Set(events.flatMap((event) => (event.projectId ? [event.projectId] : [])))];
  const eventProjects = projectIds.length
    ? await prisma.project.findMany({ where: { id: { in: projectIds } }, select: { id: true, name: true } })
    : [];
  const projectNames = new Map(eventProjects.map((project) => [project.id, project.name]));
  const activeSessions = user.sessions.filter((session) => session.expiresAt > now);
  const nextExpiry = activeSessions.reduce<Date | null>((earliest, session) => {
    if (!earliest || session.expiresAt < earliest) return session.expiresAt;
    return earliest;
  }, null);

  return {
    id: user.id,
    name: user.name,
    email: user.email,
    role: user.role,
    emailVerified: user.emailVerified,
    suspendedAt: user.suspendedAt?.toISOString() ?? null,
    createdAt: user.createdAt.toISOString(),
    updatedAt: user.updatedAt.toISOString(),
    providers: [...new Set(user.accounts.map((account) => account.providerId))].sort(),
    providerConnections: user.accounts.map((account) => ({
      provider: account.providerId,
      connectedAt: account.createdAt.toISOString(),
      updatedAt: account.updatedAt.toISOString(),
    })),
    sessions: {
      active: activeSessions.length,
      lastActiveAt: user.sessions[0]?.updatedAt.toISOString() ?? null,
      nextExpiryAt: nextExpiry?.toISOString() ?? null,
    },
    workspaces: user.members.map((member) => {
      const project = member.organization.projects[0];
      const metadata = parseWorkspaceMetadata(member.organization.metadata);
      const latestDeployment = project?.deployments[0];
      const domainIssues = project?.domains.filter((domain) => domain.dnsStatus === 'ERROR' || domain.sslStatus === 'ERROR').length ?? 0;
      return {
        membershipId: member.id,
        organizationId: member.organization.id,
        organizationName: member.organization.name,
        role: member.role,
        joinedAt: member.createdAt.toISOString(),
        plan: metadata.plan,
        project: project
          ? {
              id: project.id,
              name: project.name,
              slug: project.slug,
              takedownAt: project.takedownAt?.toISOString() ?? null,
              updatedAt: project.updatedAt.toISOString(),
              latestDeployment: latestDeployment
                ? {
                    status: latestDeployment.status,
                    version: latestDeployment.version,
                    at: (latestDeployment.completedAt ?? latestDeployment.createdAt).toISOString(),
                  }
                : null,
              domains: project.domains.length,
              domainIssues,
            }
          : null,
      };
    }),
    activity: events.map((event) => ({
      id: event.id,
      type: event.type,
      projectId: event.projectId,
      projectName: event.projectId ? (projectNames.get(event.projectId) ?? null) : null,
      createdAt: event.createdAt.toISOString(),
    })),
  };
}

/** Promote/demote a user's platform role. Refuses to demote the last admin so the
 *  panel can never lock everyone out. */
export async function setUserRole(userId: string, role: 'user' | 'admin') {
  const target = await prisma.user.findUnique({ where: { id: userId }, select: { role: true } });
  if (!target) {
    throw notFound('User', { id: userId });
  }
  if (role === 'user' && target.role === 'admin') {
    const admins = await prisma.user.count({ where: { role: 'admin' } });
    if (admins <= 1) {
      throw new AppError({ code: 'http:conflict', message: 'Cannot remove the last admin.' });
    }
  }
  await prisma.user.update({ where: { id: userId }, data: { role } });
  return { ok: true as const };
}

/** Every documentation site (Project) on the instance with owner + counts. */
export async function listAdminSites() {
  const sites = await prisma.project.findMany({
    select: {
      id: true,
      name: true,
      slug: true,
      accessMode: true,
      takedownAt: true,
      takedownReason: true,
      createdAt: true,
      updatedAt: true,
      deployments: { orderBy: { createdAt: 'desc' }, take: 1, select: { version: true, status: true, createdAt: true, completedAt: true } },
      domains: { select: { dnsStatus: true, sslStatus: true } },
      _count: { select: { pages: true, deployments: true, languages: true } },
      organization: {
        select: {
          id: true,
          name: true,
          metadata: true,
          _count: { select: { members: true } },
          members: { where: { role: 'owner' }, take: 1, select: { user: { select: { email: true } } } },
          invitations: { where: { role: 'owner', status: 'pending' }, take: 1, select: { id: true, email: true } },
        },
      },
    },
    orderBy: { createdAt: 'desc' },
    take: 500,
  });
  return sites.map((s) => {
    const latestDeployment = s.deployments[0];
    return {
      latestDeployment: latestDeployment
        ? {
            version: latestDeployment.version,
            status: latestDeployment.status,
            at: (latestDeployment.completedAt ?? latestDeployment.createdAt).toISOString(),
          }
        : null,
      id: s.id,
      name: s.name,
      slug: s.slug,
      org: s.organization?.name ?? '—',
      organizationId: s.organization?.id ?? null,
      plan: parseWorkspaceMetadata(s.organization?.metadata ?? null).plan,
      owner: s.organization?.members[0]?.user.email ?? s.organization?.invitations[0]?.email ?? '—',
      ownerStatus: s.organization?.members[0] ? ('active' as const) : s.organization?.invitations[0] ? ('invited' as const) : ('missing' as const),
      ownerInvitationId: s.organization?.invitations[0]?.id ?? null,
      pages: s._count.pages,
      deployments: s._count.deployments,
      languages: s._count.languages,
      members: s.organization?._count.members ?? 0,
      domains: s.domains.length,
      domainIssues: s.domains.filter((domain) => domain.dnsStatus === 'ERROR' || domain.sslStatus === 'ERROR').length,
      accessMode: s.accessMode,
      takedownAt: s.takedownAt?.toISOString() ?? null,
      takedownReason: s.takedownReason,
      createdAt: s.createdAt.toISOString(),
      updatedAt: s.updatedAt.toISOString(),
    };
  });
}

/** Full operational context for one site/workspace. Sensitive document content,
 * credentials, provider payloads, raw errors, IP data, and tokens are excluded. */
export async function getAdminSite(projectId: string) {
  const project = await prisma.project.findUnique({
    where: { id: projectId },
    select: {
      id: true,
      name: true,
      slug: true,
      description: true,
      accessMode: true,
      takedownAt: true,
      takedownReason: true,
      createdAt: true,
      updatedAt: true,
      organization: {
        select: {
          id: true,
          name: true,
          metadata: true,
          members: {
            orderBy: { createdAt: 'asc' },
            select: {
              id: true,
              role: true,
              createdAt: true,
              user: { select: { id: true, name: true, email: true, role: true, emailVerified: true, suspendedAt: true } },
            },
          },
          invitations: {
            where: { status: 'pending' },
            orderBy: { expiresAt: 'asc' },
            select: { id: true, email: true, role: true, expiresAt: true },
          },
        },
      },
      languages: { orderBy: { position: 'asc' }, select: { code: true, label: true, direction: true, enabled: true, isDefault: true } },
      deployments: {
        orderBy: { createdAt: 'desc' },
        take: 30,
        select: { id: true, version: true, status: true, pagesCount: true, createdById: true, createdAt: true, completedAt: true },
      },
      domains: {
        orderBy: [{ isPrimary: 'desc' }, { createdAt: 'asc' }],
        select: {
          id: true,
          domain: true,
          verified: true,
          provider: true,
          isPrimary: true,
          dnsStatus: true,
          sslStatus: true,
          lastCheckedAt: true,
          lastError: true,
          createdAt: true,
          verifiedAt: true,
        },
      },
      jwtAccess: { select: { enabled: true, updatedAt: true } },
      gitConnection: {
        select: {
          provider: true,
          lastSyncStatus: true,
          lastSyncError: true,
          lastSyncedAt: true,
          createdAt: true,
          operations: {
            orderBy: { createdAt: 'desc' },
            take: 10,
            select: { id: true, kind: true, status: true, createdAt: true, completedAt: true },
          },
        },
      },
      _count: { select: { readers: true, audiences: true } },
    },
  });
  if (!project) {
    throw notFound('Project', { id: projectId });
  }

  const [usage, exportStatuses, recentEvents] = await Promise.all([
    getProjectUsage(project.organization.id, project.id),
    prisma.exportJob.groupBy({ by: ['status'], where: { projectId }, _count: { _all: true } }),
    prisma.platformEvent.findMany({
      where: { projectId },
      orderBy: { createdAt: 'desc' },
      take: 30,
      select: { id: true, type: true, userId: true, createdAt: true },
    }),
  ]);
  const actorIds = [...new Set(recentEvents.flatMap((event) => (event.userId ? [event.userId] : [])))];
  const actors = actorIds.length ? await prisma.user.findMany({ where: { id: { in: actorIds } }, select: { id: true, name: true } }) : [];
  const actorNames = new Map(actors.map((actor) => [actor.id, actor.name]));
  const metadata = parseWorkspaceMetadata(project.organization.metadata);

  return {
    id: project.id,
    name: project.name,
    slug: project.slug,
    description: project.description,
    accessMode: project.accessMode,
    takedownAt: project.takedownAt?.toISOString() ?? null,
    takedownReason: project.takedownReason,
    createdAt: project.createdAt.toISOString(),
    updatedAt: project.updatedAt.toISOString(),
    workspace: { id: project.organization.id, name: project.organization.name, plan: metadata.plan },
    usage,
    access: {
      mode: project.accessMode,
      readers: project._count.readers,
      audiences: project._count.audiences,
      jwtEnabled: project.jwtAccess?.enabled ?? false,
    },
    languages: project.languages,
    members: project.organization.members.map((member) => ({
      id: member.id,
      role: member.role,
      joinedAt: member.createdAt.toISOString(),
      user: {
        id: member.user.id,
        name: member.user.name,
        email: member.user.email,
        role: member.user.role,
        emailVerified: member.user.emailVerified,
        suspendedAt: member.user.suspendedAt?.toISOString() ?? null,
      },
    })),
    invitations: project.organization.invitations.map((invitation) => ({
      id: invitation.id,
      email: invitation.email,
      role: invitation.role,
      expiresAt: invitation.expiresAt.toISOString(),
      expired: invitation.expiresAt < new Date(),
    })),
    deployments: project.deployments.map((deployment) => ({
      id: deployment.id,
      version: deployment.version,
      status: deployment.status,
      pages: deployment.pagesCount,
      actorUserId: deployment.createdById,
      createdAt: deployment.createdAt.toISOString(),
      completedAt: deployment.completedAt?.toISOString() ?? null,
    })),
    domains: project.domains.map((domain) => ({
      id: domain.id,
      domain: domain.domain,
      verified: domain.verified,
      provider: domain.provider,
      isPrimary: domain.isPrimary,
      dnsStatus: domain.dnsStatus,
      sslStatus: domain.sslStatus,
      lastCheckedAt: domain.lastCheckedAt?.toISOString() ?? null,
      hasError: Boolean(domain.lastError),
      createdAt: domain.createdAt.toISOString(),
      verifiedAt: domain.verifiedAt?.toISOString() ?? null,
    })),
    exports: Object.fromEntries(exportStatuses.map((status) => [status.status, status._count._all])),
    git: project.gitConnection
      ? {
          provider: project.gitConnection.provider,
          status: project.gitConnection.lastSyncStatus,
          hasError: Boolean(project.gitConnection.lastSyncError),
          lastSyncedAt: project.gitConnection.lastSyncedAt?.toISOString() ?? null,
          connectedAt: project.gitConnection.createdAt.toISOString(),
          operations: project.gitConnection.operations.map((operation) => ({
            id: operation.id,
            kind: operation.kind,
            status: operation.status,
            createdAt: operation.createdAt.toISOString(),
            completedAt: operation.completedAt?.toISOString() ?? null,
          })),
        }
      : null,
    activity: recentEvents.map((event) => ({
      id: event.id,
      type: event.type,
      actorUserId: event.userId,
      actorName: event.userId ? (actorNames.get(event.userId) ?? null) : null,
      createdAt: event.createdAt.toISOString(),
    })),
  };
}

/** Cross-product queues and provider health for support triage. Raw error text
 * is intentionally represented only as a boolean to avoid leaking customer
 * content, repository URLs, provider payloads, or credentials. */
export async function getAdminOperations() {
  const [deployments, domains, exports, gitOperations] = await Promise.all([
    prisma.deployment.findMany({
      orderBy: { createdAt: 'desc' },
      take: 100,
      select: {
        id: true,
        version: true,
        status: true,
        pagesCount: true,
        error: true,
        createdAt: true,
        completedAt: true,
        project: { select: { id: true, name: true } },
      },
    }),
    prisma.domain.findMany({
      orderBy: { createdAt: 'desc' },
      take: 100,
      select: {
        id: true,
        domain: true,
        provider: true,
        dnsStatus: true,
        sslStatus: true,
        isPrimary: true,
        lastError: true,
        lastCheckedAt: true,
        createdAt: true,
        project: { select: { id: true, name: true } },
      },
    }),
    prisma.exportJob.findMany({
      orderBy: { createdAt: 'desc' },
      take: 50,
      select: {
        id: true,
        status: true,
        trigger: true,
        attempts: true,
        error: true,
        createdAt: true,
        completedAt: true,
        project: { select: { id: true, name: true } },
      },
    }),
    prisma.gitSyncOperation.findMany({
      orderBy: { createdAt: 'desc' },
      take: 50,
      select: {
        id: true,
        kind: true,
        status: true,
        error: true,
        createdAt: true,
        completedAt: true,
        connection: { select: { project: { select: { id: true, name: true } } } },
      },
    }),
  ]);

  return {
    deployments: deployments.map((deployment) => ({
      id: deployment.id,
      projectId: deployment.project.id,
      projectName: deployment.project.name,
      version: deployment.version,
      status: deployment.status,
      pages: deployment.pagesCount,
      hasError: Boolean(deployment.error),
      createdAt: deployment.createdAt.toISOString(),
      completedAt: deployment.completedAt?.toISOString() ?? null,
    })),
    domains: domains.map((domain) => ({
      id: domain.id,
      projectId: domain.project.id,
      projectName: domain.project.name,
      domain: domain.domain,
      provider: domain.provider,
      dnsStatus: domain.dnsStatus,
      sslStatus: domain.sslStatus,
      isPrimary: domain.isPrimary,
      hasError: Boolean(domain.lastError),
      lastCheckedAt: domain.lastCheckedAt?.toISOString() ?? null,
      createdAt: domain.createdAt.toISOString(),
    })),
    exports: exports.map((job) => ({
      id: job.id,
      projectId: job.project.id,
      projectName: job.project.name,
      status: job.status,
      trigger: job.trigger,
      attempts: job.attempts,
      hasError: Boolean(job.error),
      createdAt: job.createdAt.toISOString(),
      completedAt: job.completedAt?.toISOString() ?? null,
    })),
    git: gitOperations.map((operation) => ({
      id: operation.id,
      projectId: operation.connection.project.id,
      projectName: operation.connection.project.name,
      kind: operation.kind,
      status: operation.status,
      hasError: Boolean(operation.error),
      createdAt: operation.createdAt.toISOString(),
      completedAt: operation.completedAt?.toISOString() ?? null,
    })),
  };
}

// ─── Moderation ──────────────────────────────────────────────────────────────

/** Suspend a user: sets `suspendedAt` and revokes every active session, so the
 *  lockout is immediate (the auth guard also rejects any straggler requests).
 *  Platform admins can never be suspended — demote them first (`setUserRole`
 *  keeps its last-admin protection), so the panel can never lock everyone out. */
export async function suspendUser(userId: string) {
  const target = await prisma.user.findUnique({ where: { id: userId }, select: { role: true, suspendedAt: true } });
  if (!target) {
    throw notFound('User', { id: userId });
  }
  if (target.role === 'admin') {
    throw new AppError({ code: 'http:conflict', message: 'Platform admins cannot be suspended. Demote them to a regular user first.' });
  }
  if (target.suspendedAt) {
    return { ok: true as const };
  }
  await prisma.user.update({
    where: { id: userId },
    data: { suspendedAt: new Date(), banned: true, banReason: 'Suspended by a Nibleaf operator', banExpires: null },
  });
  // Sessions are DB-backed (better-auth Prisma adapter), so deleting the rows
  // signs the user out everywhere on their next request.
  await prisma.session.deleteMany({ where: { userId } });
  return { ok: true as const };
}

/** Lift a suspension: the user can sign in again. */
export async function unsuspendUser(userId: string) {
  const target = await prisma.user.findUnique({ where: { id: userId }, select: { id: true } });
  if (!target) {
    throw notFound('User', { id: userId });
  }
  await prisma.user.update({ where: { id: userId }, data: { suspendedAt: null, banned: false, banReason: null, banExpires: null } });
  return { ok: true as const };
}

/** Take a site down for moderation: the published site must stop being served
 *  (enforced in the public read path) and new publishes are refused. */
export async function takedownProject(projectId: string, reason?: string) {
  const project = await prisma.project.findUnique({ where: { id: projectId }, select: { id: true } });
  if (!project) {
    throw notFound('Project', { id: projectId });
  }
  await prisma.project.update({ where: { id: projectId }, data: { takedownAt: new Date(), takedownReason: reason?.trim() || null } });
  return { ok: true as const };
}

/** Restore a taken-down site: it serves and publishes again. */
export async function restoreProject(projectId: string) {
  const project = await prisma.project.findUnique({ where: { id: projectId }, select: { id: true } });
  if (!project) {
    throw notFound('Project', { id: projectId });
  }
  await prisma.project.update({ where: { id: projectId }, data: { takedownAt: null, takedownReason: null } });
  return { ok: true as const };
}
