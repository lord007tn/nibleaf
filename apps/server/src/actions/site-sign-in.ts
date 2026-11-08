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
/** How long codes are kept: long enough for the day-long budgets above. The
 *  pause lives in `site_sign_in_guard`, so cleaning up codes never affects it. */
const SIGN_IN_HISTORY_MS = SIGN_IN_DAY_MS + SIGN_IN_WINDOW_MS;
/** Guards with no running pause are dropped after a week without activity. */
const SIGN_IN_GUARD_RETENTION_MS = 7 * SIGN_IN_DAY_MS;

/** Take the per-(site, address) lock for this transaction without waiting:
 *  issuance and guesses for one address run one at a time, and a request that
 *  finds the lock taken gives up at once rather than holding a pooled connection. */
const tryLockAddress = async (tx: Prisma.TransactionClient, projectId: string, email: string): Promise<boolean> => {
  const [lock] = await tx.$queryRaw<Array<{ locked: boolean }>>`
    SELECT pg_try_advisory_xact_lock(hashtextextended(${`site-sign-in:${projectId}:${email}`}, 0)) AS "locked"`;
  return Boolean(lock?.locked);
};
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
    select: { userId: true, user: { select: { banned: true, suspendedAt: true } } },
  });
  // A suspended account gets no code and no session, as on the dashboard, and
  // doesn't get in as a reader under the same address either.
  if (member?.user.banned || member?.user.suspendedAt) return null;
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
 * - after 3 codes that each ran out of guesses since the last successful sign-in,
 *   none for 24 hours from the moment the third ran out (the address's
 *   `site_sign_in_guard`, updated in verifySiteSignIn).
 * Codes are kept for these look-backs (see SIGN_IN_HISTORY_MS).
 */
const mayIssueCode = async (tx: Prisma.TransactionClient, projectId: string, email: string, now: number): Promise<boolean> => {
  const recent = await tx.siteSignInCode.findMany({
    where: { projectId, email, createdAt: { gt: new Date(now - SIGN_IN_DAY_MS) } },
    orderBy: { createdAt: 'desc' },
    select: { createdAt: true, attempts: true },
  });
  if (recent.length >= SIGN_IN_CODES_PER_DAY) return false;
  if (recent.filter((row) => row.createdAt.getTime() > now - SIGN_IN_WINDOW_MS).length >= SIGN_IN_CODES_PER_WINDOW) return false;
  const guard = await tx.siteSignInGuard.findUnique({ where: { projectId_email: { projectId, email } }, select: { pausedUntil: true } });
  return !(guard?.pausedUntil && guard.pausedUntil.getTime() > now);
};

const issueCode = async (projectId: string, email: string, language?: string) => {
  const code = String(randomInt(0, 1_000_000)).padStart(6, '0');
  // One issuance per (site, address) at a time, so parallel requests can't all
  // pass the budget check before any of them records a code. A request that
  // finds another issuance in progress sends nothing rather than waiting for the
  // lock, so a burst for one address never holds pooled connections.
  const row = await prisma.$transaction(async (tx) => {
    if (!(await tryLockAddress(tx, projectId, email))) return null;
    if (!(await mayIssueCode(tx, projectId, email, Date.now()))) return null;
    const created = await tx.siteSignInCode.create({
      data: { projectId, email, codeHash: 'pending', expiresAt: new Date(Date.now() + SIGN_IN_CODE_TTL_MS) },
      select: { id: true, expiresAt: true, project: { select: { name: true } } },
    });
    await tx.siteSignInCode.update({ where: { id: created.id }, data: { codeHash: codeHash(created.id, code) } });
    return created;
  });
  if (!row) return;
  let message: Awaited<ReturnType<typeof renderSiteSignInCodeEmail>>;
  try {
    message = await renderSiteSignInCodeEmail({ code, projectName: row.project.name, language: resolveEmailLanguage(language) });
  } catch (error) {
    // Nothing was queued, so this code can never arrive: it doesn't count
    // against the address's budget.
    await prisma.siteSignInCode.deleteMany({ where: { id: row.id, consumedAt: null, attempts: 0 } }).catch(() => undefined);
    throw error;
  }
  // An enqueue error is ambiguous (the queue may have accepted the job), so the
  // code stays usable and counted. The worker discards it once it has expired.
  await createJob(QueueNames.EMAIL, {
    name: 'send-email',
    data: { to: email, ...message, auth: { purpose: 'otp', expiresAt: row.expiresAt.getTime() } },
  });
  void prisma.siteSignInCode.deleteMany({ where: { createdAt: { lt: new Date(Date.now() - SIGN_IN_HISTORY_MS) } } }).catch(() => undefined);
  void prisma.siteSignInGuard
    .deleteMany({
      where: {
        updatedAt: { lt: new Date(Date.now() - SIGN_IN_GUARD_RETENTION_MS) },
        OR: [{ pausedUntil: null }, { pausedUntil: { lt: new Date() } }],
      },
    })
    .catch(() => undefined);
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
  const email = body.email;
  // One transaction under the address lock: counting the guess, recording a
  // burned code (and the pause it may start) and using the code all happen
  // together, so no code can be issued in between. It returns instead of
  // throwing so a counted guess is committed.
  const accepted = await prisma.$transaction(async (tx) => {
    if (!(await tryLockAddress(tx, projectId, email))) return false;
    // Only the newest code counts. Once it is used or has expired, every
    // earlier code stays superseded.
    const latest = await tx.siteSignInCode.findFirst({
      where: { projectId, email },
      orderBy: { createdAt: 'desc' },
      select: { id: true, codeHash: true, consumedAt: true, expiresAt: true, attempts: true },
    });
    if (!latest || latest.consumedAt || latest.expiresAt <= now || latest.attempts >= SIGN_IN_CODE_MAX_ATTEMPTS) return false;
    const attempts = latest.attempts + 1;
    await tx.siteSignInCode.update({ where: { id: latest.id }, data: { attempts } });
    if (!sameHash(latest.codeHash, codeHash(latest.id, body.code))) {
      if (attempts >= SIGN_IN_CODE_MAX_ATTEMPTS) {
        // This guess used the code up: one more burned code for the address.
        const guard = await tx.siteSignInGuard.upsert({
          where: { projectId_email: { projectId, email } },
          create: { projectId, email, burnedCodes: 1 },
          update: { burnedCodes: { increment: 1 } },
          select: { burnedCodes: true },
        });
        if (guard.burnedCodes >= SIGN_IN_BURNED_CODES_LOCKOUT) {
          await tx.siteSignInGuard.update({
            where: { projectId_email: { projectId, email } },
            data: { burnedCodes: 0, pausedUntil: new Date(now.getTime() + SIGN_IN_DAY_MS) },
          });
        }
      }
      return false;
    }
    await tx.siteSignInCode.update({ where: { id: latest.id }, data: { consumedAt: now } });
    // A successful sign-in ends the streak of burned codes.
    await tx.siteSignInGuard.updateMany({ where: { projectId, email }, data: { burnedCodes: 0 } });
    return true;
  });
  if (!accepted) throw invalidCode();
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
