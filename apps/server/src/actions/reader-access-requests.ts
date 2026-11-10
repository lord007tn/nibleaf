import { createJob, QueueNames } from '@nibleaf/bullmq';
import { prisma } from '@nibleaf/database';
import { type EmailLanguage, renderReaderAccessRequestEmail, resolveEmailLanguage } from '@nibleaf/email';
import { createLogger } from '@nibleaf/logger';
import type { ReaderAccessRequestBody, ReaderAccessRequestsSettingBody } from '@nibleaf/validators';
import { env } from '@/env';
import { conflict, notFound } from '@/errors';
import { createNotificationsForOrgMembers } from './notifications';
import { inviteReader, logAudit } from './reader-access';
import { signInIdentity } from './site-sign-in';

/**
 * Access requests from a private site's sign-in screen.
 *
 * Someone who can't read an Invited readers site may ask its Admins for access,
 * when an Admin turned that on. The answer is always the same, recorded or not,
 * so the form never tells who can read a site, who asked before, or whether the
 * site takes requests. Admins get a bell notification and an email, and approve
 * (which invites the person to the whole site) or decline from the reader list.
 */
const log = createLogger({ module: 'reader-access-requests' });

/** New requests a site accepts per hour, so a flood can't bury its Admins. */
const REQUESTS_PER_SITE_PER_HOUR = 20;
/** A declined address can't ask again for this long. */
const DECLINED_COOLDOWN_MS = 30 * 24 * 60 * 60_000;
const ADMIN_ROLES = ['owner', 'admin'];

const recordRequest = async (projectId: string, body: ReaderAccessRequestBody) => {
  const project = await prisma.project.findUnique({
    where: { id: projectId },
    select: {
      name: true,
      accessMode: true,
      takedownAt: true,
      readerAccessRequests: true,
      organizationId: true,
      languages: { where: { isDefault: true }, select: { code: true }, take: 1 },
    },
  });
  if (!project || project.takedownAt || project.accessMode !== 'READERS' || !project.readerAccessRequests) return;
  const email = body.email;
  // Already able to sign in (a member, an invited reader, an allowed domain): nothing to ask for.
  if (await signInIdentity(projectId, email)) return;
  // A revoked reader, or a member of the site (a suspended one included), doesn't get to ask.
  const [reader, member] = await Promise.all([
    prisma.reader.findUnique({ where: { projectId_email: { projectId, email } }, select: { id: true } }),
    prisma.member.findFirst({
      where: {
        organizationId: project.organizationId,
        user: { email },
        OR: [{ orgRole: { in: ADMIN_ROLES } }, { orgRole: 'member', projectGrants: { some: { projectId } } }],
      },
      select: { id: true },
    }),
  ]);
  if (reader || member) return;
  const recent = await prisma.readerAccessRequest.count({ where: { projectId, createdAt: { gt: new Date(Date.now() - 60 * 60_000) } } });
  if (recent >= REQUESTS_PER_SITE_PER_HOUR) return;

  const fields = { name: body.name || null, note: body.note || null };
  let created = false;
  try {
    await prisma.readerAccessRequest.create({ data: { projectId, email, ...fields } });
    created = true;
  } catch (error) {
    if ((error as { code?: unknown }).code !== 'P2002') throw error;
    // Asked before: only a request declined long enough ago (or approved, then
    // revoked, which the checks above already stopped) opens again.
    const reopened = await prisma.readerAccessRequest.updateMany({
      where: { projectId, email, status: 'DECLINED', decidedAt: { lt: new Date(Date.now() - DECLINED_COOLDOWN_MS) } },
      data: { ...fields, status: 'PENDING', createdAt: new Date(), decidedAt: null, decidedById: null },
    });
    created = reopened.count === 1;
  }
  if (!created) return;
  await logAudit({ projectId, action: 'ACCESS_REQUESTED', metadata: { email } });
  await notifyAdmins(projectId, project, { email, name: fields.name, note: fields.note });
};

/** A bell notification and an email for the site's Owners and Admins only. */
const notifyAdmins = async (
  projectId: string,
  project: { name: string; organizationId: string; languages: Array<{ code: string }> },
  request: { email: string; name: string | null; note: string | null },
) => {
  const admins = await prisma.member.findMany({
    where: {
      organizationId: project.organizationId,
      user: { banned: false, suspendedAt: null },
      OR: [{ orgRole: { in: ADMIN_ROLES } }, { orgRole: 'member', projectGrants: { some: { projectId, role: 'admin' } } }],
    },
    select: { userId: true, user: { select: { email: true } } },
  });
  const requester = request.name ? `${request.name} (${request.email})` : request.email;
  const href = `/app/projects/${projectId}/settings?section=authentication`;
  await createNotificationsForOrgMembers(
    projectId,
    {
      type: 'access_request',
      title: `${requester} asked to read ${project.name}`,
      body: request.note ?? undefined,
      params: { requester, projectName: project.name, note: request.note },
      href,
    },
    { roles: ADMIN_ROLES },
  ).catch((error: unknown) => log.warn({ error, projectId }, 'Access request notification not created'));
  // Written for the team, so in the site's own language rather than the visitor's.
  const language: EmailLanguage = resolveEmailLanguage(project.languages[0]?.code);
  const message = await renderReaderAccessRequestEmail({
    projectName: project.name,
    requester,
    note: request.note,
    reviewUrl: `${env.APP_URL.replace(/\/+$/, '')}${href}`,
    language,
  });
  await Promise.all(
    admins.map((admin) =>
      admin.user.email
        ? createJob(QueueNames.EMAIL, {
            name: 'send-email',
            data: { to: admin.user.email, ...message, teamAccess: { userId: admin.userId, projectId, minimumRole: 'admin' } },
          }).catch(() => undefined)
        : undefined,
    ),
  );
};

/** Ask for access. Always answers the same; the work happens after the response. */
export const requestReaderAccess = (projectId: string, body: ReaderAccessRequestBody) => {
  void recordRequest(projectId, body).catch((error: unknown) => log.warn({ error, projectId }, 'Access request not recorded'));
  return { received: true };
};

export const setReaderAccessRequests = async (projectId: string, actorUserId: string, body: ReaderAccessRequestsSettingBody) => {
  const project = await prisma.project.update({
    where: { id: projectId },
    data: { readerAccessRequests: body.enabled },
    select: { readerAccessRequests: true },
  });
  await logAudit({ projectId, actorUserId, action: 'ACCESS_REQUESTS_CHANGED', metadata: { enabled: body.enabled } });
  return { enabled: project.readerAccessRequests };
};

const decide = async (projectId: string, requestId: string, actorUserId: string, status: 'APPROVED' | 'DECLINED') => {
  const decided = await prisma.readerAccessRequest.updateMany({
    where: { id: requestId, projectId, status: 'PENDING' },
    data: { status, decidedAt: new Date(), decidedById: actorUserId },
  });
  if (decided.count !== 1) {
    const exists = await prisma.readerAccessRequest.findFirst({ where: { id: requestId, projectId }, select: { id: true } });
    if (!exists) throw notFound('access request', { id: requestId });
    throw conflict('This request was already answered.');
  }
  return prisma.readerAccessRequest.findUniqueOrThrow({ where: { id: requestId }, select: { id: true, email: true, name: true } });
};

/** Approve: invite the person to the whole site (they get the usual invitation email). */
export const approveReaderAccessRequest = async (projectId: string, requestId: string, actorUserId: string, language?: EmailLanguage) => {
  const request = await decide(projectId, requestId, actorUserId, 'APPROVED');
  const invited = await inviteReader(projectId, actorUserId, { email: request.email, ...(request.name ? { name: request.name } : {}) }, language);
  await logAudit({ projectId, readerId: invited.reader.id, actorUserId, action: 'ACCESS_REQUEST_APPROVED' });
  return { id: request.id, readerId: invited.reader.id };
};

/** Decline quietly: the person isn't told, and can't ask again for 30 days. */
export const declineReaderAccessRequest = async (projectId: string, requestId: string, actorUserId: string) => {
  const request = await decide(projectId, requestId, actorUserId, 'DECLINED');
  await logAudit({ projectId, actorUserId, action: 'ACCESS_REQUEST_DECLINED', metadata: { email: request.email } });
  return { id: request.id };
};
