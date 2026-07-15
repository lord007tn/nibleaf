import { prisma } from '@nibleaf/database';
import { slugify } from '@nibleaf/shared';
import { env } from '@/env';
import { AppError, notFound } from '@/errors';
import { inviteMember } from './members';

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
    const invitation = await inviteMember(
      created.organization.id,
      adminUserId,
      'owner',
      { email: ownerEmail, role: 'owner' },
      { sendEmail: input.delivery === 'email' },
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
  const [users, admins, sites, deployments, ready, recentUsers, verifiedUsers] = await Promise.all([
    prisma.user.count(),
    prisma.user.count({ where: { role: 'admin' } }),
    prisma.project.count(),
    prisma.deployment.count(),
    prisma.deployment.count({ where: { status: 'READY' } }),
    prisma.user.count({ where: { createdAt: { gte: new Date(Date.now() - 7 * 24 * 60 * 60 * 1000) } } }),
    prisma.user.count({ where: { emailVerified: true } }),
  ]);
  return { users, admins, sites, deployments, publishedDeployments: ready, recentUsers, verifiedUsers };
}

/** Every user on the instance, newest first, with workspace-membership count. */
export async function listAdminUsers() {
  const users = await prisma.user.findMany({
    select: {
      id: true,
      name: true,
      email: true,
      role: true,
      emailVerified: true,
      suspendedAt: true,
      createdAt: true,
      _count: { select: { members: true } },
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
    createdAt: u.createdAt.toISOString(),
  }));
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
      takedownAt: true,
      takedownReason: true,
      createdAt: true,
      _count: { select: { pages: true, deployments: true } },
      organization: {
        select: {
          name: true,
          members: { where: { role: 'owner' }, take: 1, select: { user: { select: { email: true } } } },
          invitations: { where: { role: 'owner', status: 'pending' }, take: 1, select: { id: true, email: true } },
        },
      },
    },
    orderBy: { createdAt: 'desc' },
    take: 500,
  });
  return sites.map((s) => ({
    id: s.id,
    name: s.name,
    slug: s.slug,
    org: s.organization?.name ?? '—',
    owner: s.organization?.members[0]?.user.email ?? s.organization?.invitations[0]?.email ?? '—',
    ownerStatus: s.organization?.members[0] ? ('active' as const) : s.organization?.invitations[0] ? ('invited' as const) : ('missing' as const),
    ownerInvitationId: s.organization?.invitations[0]?.id ?? null,
    pages: s._count.pages,
    deployments: s._count.deployments,
    takedownAt: s.takedownAt?.toISOString() ?? null,
    takedownReason: s.takedownReason,
    createdAt: s.createdAt.toISOString(),
  }));
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
  await prisma.user.update({ where: { id: userId }, data: { suspendedAt: new Date() } });
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
  await prisma.user.update({ where: { id: userId }, data: { suspendedAt: null } });
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
