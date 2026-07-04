import { Prisma, prisma } from '@midad/database';
import { AppError, notFound } from '@/errors';

/** Platform-wide counts + recent activity for the admin overview screen. */
export async function getAdminOverview() {
  const [users, admins, sites, deployments, ready, waitlist, recentUsers] = await Promise.all([
    prisma.user.count(),
    prisma.user.count({ where: { role: 'admin' } }),
    prisma.project.count(),
    prisma.deployment.count(),
    prisma.deployment.count({ where: { status: 'READY' } }),
    prisma.waitlistEntry.count(),
    prisma.user.count({ where: { createdAt: { gte: new Date(Date.now() - 7 * 24 * 60 * 60 * 1000) } } }),
  ]);
  return { users, admins, sites, deployments, publishedDeployments: ready, waitlist, recentUsers };
}

/** Every user on the instance, newest first, with workspace-membership count. */
export async function listAdminUsers() {
  const users = await prisma.user.findMany({
    select: { id: true, name: true, email: true, role: true, emailVerified: true, createdAt: true, _count: { select: { members: true } } },
    orderBy: { createdAt: 'desc' },
    take: 500,
  });
  return users.map((u) => ({
    id: u.id,
    name: u.name,
    email: u.email,
    role: u.role,
    emailVerified: u.emailVerified,
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
      createdAt: true,
      _count: { select: { pages: true, deployments: true } },
      organization: {
        select: { name: true, members: { where: { role: 'owner' }, take: 1, select: { user: { select: { email: true } } } } },
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
    owner: s.organization?.members[0]?.user.email ?? '—',
    pages: s._count.pages,
    deployments: s._count.deployments,
    createdAt: s.createdAt.toISOString(),
  }));
}

/** Cloud-waitlist signups, newest first. */
export async function listWaitlist() {
  const rows = await prisma.waitlistEntry.findMany({ orderBy: { createdAt: 'desc' }, take: 1000 });
  return rows.map((r) => ({ id: r.id, email: r.email, source: r.source, locale: r.locale, createdAt: r.createdAt.toISOString() }));
}

export async function deleteWaitlistEntry(id: string) {
  try {
    await prisma.waitlistEntry.delete({ where: { id } });
  } catch (err) {
    if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2025') {
      throw notFound('Waitlist entry', { id });
    }
    throw err;
  }
  return { ok: true as const };
}
