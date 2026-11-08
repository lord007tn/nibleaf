import { randomInt, timingSafeEqual } from 'node:crypto';
import { createJob, QueueNames } from '@nibleaf/bullmq';
import { type Prisma, prisma } from '@nibleaf/database';
import { renderSiteSignInCodeEmail, resolveEmailLanguage } from '@nibleaf/email';
import { createLogger } from '@nibleaf/logger';
import type { SiteSignInStartBody, SiteSignInVerifyBody } from '@nibleaf/validators';
import type { Context } from 'hono';
import { env } from '@/env';
import { badRequest, notFound } from '@/errors';
import type { HonoEnv } from '@/lib/hono/context';
import { logAudit, newSecret, requestFingerprint, setSessionCookie, sha256 } from './reader-access';

/**
 * Email-code sign-in on a private published site.
 *
 * Anyone may ask for a code; only an address that can read the site gets one,
 * and every answer is the same, so the form never reveals who can read a site.
 * Team members of the site (Team only and Invited readers) and invited readers
 * who were not revoked (Invited readers) are eligible. A member's session is
 * checked against the membership on every request; a reader's session follows
 * the reader's revocation and audiences exactly like an invitation session.
 */
const log = createLogger({ module: 'site-sign-in' });

const SIGN_IN_CODE_TTL_MS = 10 * 60_000;
/** Wrong guesses allowed per code. */
const SIGN_IN_CODE_MAX_ATTEMPTS = 5;
/** Codes one address can be sent per site and window. */
const SIGN_IN_CODES_PER_WINDOW = 5;
const SIGN_IN_WINDOW_MS = 15 * 60_000;
/** Codes one address can be sent per site in a rolling day. */
const SIGN_IN_CODES_PER_DAY = 10;
const SIGN_IN_DAY_MS = 24 * 60 * 60_000;
/** Consecutive codes that ran out of guesses before an address is paused for a day. */
const SIGN_IN_BURNED_CODES_LOCKOUT = 3;
/** How long codes are kept: long enough for the day-long budgets above. */
const SIGN_IN_HISTORY_MS = SIGN_IN_DAY_MS + SIGN_IN_WINDOW_MS;
const SITE_SESSION_TTL_MS = 7 * 24 * 60 * 60_000;

/** The row id salts the hash, so equal codes never share a hash. */
const codeHash = (id: string, code: string) => sha256(`${id}:${code}`);
const sameHash = (left: string, right: string) => {
  const a = Buffer.from(left);
  const b = Buffer.from(right);
  return a.length === b.length && timingSafeEqual(a, b);
};
const invalidCode = () => badRequest('That code is wrong or has expired. Ask for a new one.', { reason: 'invalid_code' });

type SignInIdentity = { kind: 'member'; userId: string } | { kind: 'reader'; readerId: string };

/** Who this address is on the site right now, or null when it may not read it. */
const signInIdentity = async (projectId: string, email: string): Promise<SignInIdentity | null> => {
  const project = await prisma.project.findUnique({
    where: { id: projectId },
    select: { accessMode: true, organizationId: true, takedownAt: true },
  });
  if (!project || project.accessMode === 'PUBLIC' || project.takedownAt) return null;
  const member = await prisma.member.findFirst({
    where: { organizationId: project.organizationId, user: { email } },
    select: { userId: true },
  });
  if (member) return { kind: 'member', userId: member.userId };
  if (project.accessMode !== 'READERS') return null;
  const reader = await prisma.reader.findUnique({ where: { projectId_email: { projectId, email } }, select: { id: true, revokedAt: true } });
  return reader && !reader.revokedAt ? { kind: 'reader', readerId: reader.id } : null;
};

/**
 * Whether this address may be sent another code now. The per-IP limit does not
 * stop a distributed attacker, so every budget is per (site, address):
 * - 5 codes per 15 minutes and 10 per rolling 24 hours, so at most 50 guesses
 *   a day and a bounded number of emails to any one inbox;
 * - after 3 consecutive codes that each ran out of guesses, none for 24 hours.
 * Codes are kept for the 24-hour look-back (see SIGN_IN_HISTORY_MS).
 */
const mayIssueCode = async (tx: Prisma.TransactionClient, projectId: string, email: string, now: number): Promise<boolean> => {
  const recent = await tx.siteSignInCode.findMany({
    where: { projectId, email, createdAt: { gt: new Date(now - SIGN_IN_DAY_MS) } },
    orderBy: { createdAt: 'desc' },
    select: { createdAt: true, attempts: true },
  });
  if (recent.length >= SIGN_IN_CODES_PER_DAY) return false;
  if (recent.filter((row) => row.createdAt.getTime() > now - SIGN_IN_WINDOW_MS).length >= SIGN_IN_CODES_PER_WINDOW) return false;
  const latest = recent.slice(0, SIGN_IN_BURNED_CODES_LOCKOUT);
  return !(latest.length === SIGN_IN_BURNED_CODES_LOCKOUT && latest.every((row) => row.attempts >= SIGN_IN_CODE_MAX_ATTEMPTS));
};

const issueCode = async (projectId: string, email: string, language?: string) => {
  const code = String(randomInt(0, 1_000_000)).padStart(6, '0');
  // One issuance per (site, address) at a time, so parallel requests can't
  // all pass the budget check before any of them records a code.
  const row = await prisma.$transaction(async (tx) => {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${`site-sign-in:${projectId}:${email}`}, 0))`;
    if (!(await mayIssueCode(tx, projectId, email, Date.now()))) return null;
    const created = await tx.siteSignInCode.create({
      data: { projectId, email, codeHash: 'pending', expiresAt: new Date(Date.now() + SIGN_IN_CODE_TTL_MS) },
      select: { id: true, project: { select: { name: true } } },
    });
    await tx.siteSignInCode.update({ where: { id: created.id }, data: { codeHash: codeHash(created.id, code) } });
    return created;
  });
  if (!row) return;
  const message = await renderSiteSignInCodeEmail({ code, projectName: row.project.name, language: resolveEmailLanguage(language) });
  await createJob(QueueNames.EMAIL, { name: 'send-email', data: { to: email, ...message } });
  void prisma.siteSignInCode.deleteMany({ where: { createdAt: { lt: new Date(Date.now() - SIGN_IN_HISTORY_MS) } } }).catch(() => undefined);
};

/** Send a sign-in code when the address may read the site. Always answers the same. */
export const startSiteSignIn = async (projectId: string, body: SiteSignInStartBody) => {
  const identity = await signInIdentity(projectId, body.email);
  // Issue outside the response so its timing never tells eligible addresses apart.
  if (identity)
    void issueCode(projectId, body.email, body.lang).catch((error: unknown) => log.warn({ error, projectId }, 'Site sign-in code not sent'));
  return { sent: true };
};

/** Exchange a code for a site session cookie. */
export const verifySiteSignIn = async (ctx: Context<HonoEnv>, projectId: string, body: SiteSignInVerifyBody) => {
  const now = new Date();
  const latest = await prisma.siteSignInCode.findFirst({
    where: { projectId, email: body.email, consumedAt: null, expiresAt: { gt: now } },
    orderBy: { createdAt: 'desc' },
    select: { id: true, codeHash: true },
  });
  if (!latest) throw invalidCode();
  // Count the guess before checking it, atomically, so parallel guesses can't
  // exceed the allowance.
  const counted = await prisma.siteSignInCode.updateMany({
    where: { id: latest.id, consumedAt: null, attempts: { lt: SIGN_IN_CODE_MAX_ATTEMPTS } },
    data: { attempts: { increment: 1 } },
  });
  if (counted.count !== 1 || !sameHash(latest.codeHash, codeHash(latest.id, body.code))) throw invalidCode();
  const consumed = await prisma.siteSignInCode.updateMany({ where: { id: latest.id, consumedAt: null }, data: { consumedAt: now } });
  if (consumed.count !== 1) throw invalidCode();
  // Eligibility can change between the code and its use (a revocation, a member removed).
  const identity = await signInIdentity(projectId, body.email);
  if (!identity) throw invalidCode();

  const token = newSecret();
  const expiresAt = new Date(now.getTime() + SITE_SESSION_TTL_MS);
  const fingerprint = requestFingerprint(ctx);
  if (identity.kind === 'member') {
    await prisma.siteMemberSession.create({ data: { projectId, userId: identity.userId, tokenHash: sha256(token), expiresAt } });
    await logAudit({ projectId, actorUserId: identity.userId, action: 'MEMBER_SIGNED_IN', ipHash: fingerprint.ipHash });
  } else {
    // Lock order reader → session, as everywhere that grants reader access. Every
    // write is conditional on the reader not being revoked, so a revocation that
    // commits first wins and one that commits after revokes this session too.
    await prisma.$transaction(async (tx) => {
      await tx.reader.updateMany({ where: { id: identity.readerId, projectId, revokedAt: null, activatedAt: null }, data: { activatedAt: now } });
      const activated = await tx.reader.updateMany({ where: { id: identity.readerId, projectId, revokedAt: null }, data: { status: 'ACTIVE' } });
      if (activated.count !== 1) throw invalidCode();
      await tx.readerSession.create({
        data: { projectId, readerId: identity.readerId, tokenHash: sha256(token), source: 'EMAIL_CODE', expiresAt, ...fingerprint },
      });
    });
    await logAudit({ projectId, readerId: identity.readerId, action: 'READER_SIGNED_IN', ipHash: fingerprint.ipHash });
  }
  setSessionCookie(ctx, projectId, token, expiresAt);
  return { ok: true };
};

/** Where an invitation link opens: the site, carrying the token in the URL
 *  fragment (never sent to a server). The page accepts it only on a click, so
 *  mail scanners that open links can't use the one-time invitation up. */
export const readerInvitationLanding = async (token: string): Promise<string> => {
  const invitation = await prisma.readerInvitation.findUnique({
    where: { tokenHash: sha256(token) },
    select: {
      projectId: true,
      project: { select: { domains: { where: { verified: true, isPrimary: true }, take: 1, select: { domain: true } } } },
    },
  });
  if (!invitation) throw notFound('reader invitation');
  const domain = invitation.project.domains[0]?.domain;
  const site = domain ? `https://${domain}/` : `${env.APP_URL.replace(/\/+$/, '')}/sites/${encodeURIComponent(invitation.projectId)}`;
  return `${site}#reader-invite=${encodeURIComponent(token)}`;
};
