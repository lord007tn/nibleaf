import { createJob, QueueNames } from '@plume/bullmq';
import { prisma } from '@plume/database';
import { createLogger } from '@plume/logger';
import { joinPath, slugify } from '@plume/shared';
import { betterAuth } from 'better-auth';
import { prismaAdapter } from 'better-auth/adapters/prisma';
import { organization } from 'better-auth/plugins';
import { keys } from './keys.server';

const env = keys();
const log = createLogger({ module: 'auth' });

/** Queue a transactional email; delivery is best-effort (logged without SMTP). */
const sendMail = (to: string, subject: string, html: string) =>
  createJob(QueueNames.EMAIL, { name: 'send-email', data: { to, subject, html } }).catch(() => undefined);

/**
 * Before a user is deleted, never orphan an organization: if they are the sole
 * member, delete the org (cascades its projects/pages); if they are the last
 * owner but others remain, promote the earliest remaining member to owner.
 */
async function reassignOrDeleteOrgs(userId: string): Promise<void> {
  const memberships = await prisma.member.findMany({ where: { userId }, select: { organizationId: true, role: true } });
  for (const membership of memberships) {
    const members = await prisma.member.findMany({
      where: { organizationId: membership.organizationId },
      select: { id: true, userId: true, role: true },
      orderBy: { createdAt: 'asc' },
    });
    const others = members.filter((m) => m.userId !== userId);
    if (others.length === 0) {
      await prisma.organization.delete({ where: { id: membership.organizationId } }).catch(() => undefined);
    } else if (membership.role === 'owner' && !others.some((m) => m.role === 'owner') && others[0]) {
      await prisma.member.update({ where: { id: others[0].id }, data: { role: 'owner' } }).catch(() => undefined);
    }
  }
}

const WELCOME_CONTENT = `# Welcome to your docs

This is your first page, built with **Plume** — the open-source documentation
platform you can self-host on your own infrastructure.

## Quick start

1. Edit this page in the editor on the left.
2. Add pages and groups to build out your navigation.
3. Hit **Publish** to ship a live, searchable documentation site.

\`\`\`bash
# Self-host in one command
docker compose up -d
\`\`\`

> Tip: pages are written in Markdown/MDX — use headings, code blocks, and callouts to structure your docs.
`;

const QUICKSTART_CONTENT = `# Quickstart

Get your documentation live in minutes.

## Install

\`\`\`bash
git clone https://github.com/plume-docs/plume
cd plume && cp .env.example .env
docker compose up -d
\`\`\`

## Write

Pages are Markdown/MDX. Organize them into groups, reorder with drag handles,
and Plume builds the navigation, search index, and table of contents for you.
`;

/** Create the starter docs site (with two pages) for a freshly created workspace. */
async function createStarterProject(organizationId: string): Promise<void> {
  const existing = await prisma.project.findFirst({ where: { organizationId }, select: { id: true } });
  if (existing) {
    return;
  }
  const project = await prisma.project.create({
    data: { organizationId, name: 'Documentation', slug: 'docs', description: 'Your first documentation site.' },
  });
  // Every project ships with a default English (LTR) language; pages live under it.
  const language = await prisma.language.create({
    data: { projectId: project.id, code: 'en', label: 'English', direction: 'LTR', isDefault: true, position: 0 },
  });
  const intro = slugify('Introduction');
  const quick = slugify('Quickstart');
  await prisma.page.createMany({
    data: [
      {
        projectId: project.id,
        languageId: language.id,
        title: 'Introduction',
        slug: intro,
        path: joinPath(null, intro),
        icon: 'book-open',
        content: WELCOME_CONTENT,
        position: 0,
      },
      {
        projectId: project.id,
        languageId: language.id,
        title: 'Quickstart',
        slug: quick,
        path: joinPath(null, quick),
        icon: 'rocket',
        content: QUICKSTART_CONTENT,
        position: 1,
      },
    ],
  });
}

/** Auto-provision a workspace + starter project so a new user lands in a usable app. */
async function provisionWorkspace(user: { id: string; name?: string | null; email: string }): Promise<void> {
  try {
    const existing = await prisma.member.findFirst({ where: { userId: user.id } });
    if (existing) {
      return;
    }
    const firstName = user.name?.split(' ')[0]?.trim();
    const org = await prisma.organization.create({
      data: {
        name: firstName ? `${firstName}'s workspace` : 'My workspace',
        slug: `${slugify(user.email.split('@')[0] ?? 'workspace')}-${Date.now().toString(36)}`,
      },
    });
    await prisma.member.create({ data: { organizationId: org.id, userId: user.id, role: 'owner' } });
    await createStarterProject(org.id);
  } catch (error) {
    // Never block sign-up on provisioning; the user can create a workspace later.
    // Log it so the failure is diagnosable instead of silently swallowed.
    log.error({ error, userId: user.id }, 'workspace provisioning failed during sign-up');
  }
}

export const auth = betterAuth({
  database: prismaAdapter(prisma, { provider: 'postgresql' }),
  secret: env.BETTER_AUTH_SECRET,
  baseURL: env.BETTER_AUTH_URL,
  basePath: '/api/auth',
  trustedOrigins: env.TRUSTED_ORIGINS,
  advanced: {
    defaultCookieAttributes: {
      httpOnly: true,
      sameSite: 'lax',
      // Drive Secure off the actual scheme, not NODE_ENV: a production stack served
      // over plain HTTP (e.g. localhost demo, or behind a proxy that terminates TLS
      // upstream) must still set a usable cookie. Behind HTTPS this is Secure.
      secure: env.BETTER_AUTH_URL.startsWith('https://'),
    },
  },
  emailAndPassword: {
    enabled: true,
    // Off by default (private self-host without SMTP); set REQUIRE_EMAIL_VERIFICATION=true
    // for public instances. The verify-email UI + resend then work via the queue below.
    requireEmailVerification: env.REQUIRE_EMAIL_VERIFICATION,
    sendResetPassword: async ({ user, url }) => {
      await sendMail(user.email, 'Reset your Plume password', `<p>Click to reset your password:</p><p><a href="${url}">${url}</a></p>`);
    },
  },
  emailVerification: {
    sendVerificationEmail: async ({ user, url }) => {
      await sendMail(
        user.email,
        'Verify your Plume email',
        `<p>Confirm your email to finish setting up your account:</p><p><a href="${url}">${url}</a></p>`,
      );
    },
  },
  user: {
    changeEmail: {
      enabled: true,
      sendChangeEmailVerification: async ({ user, newEmail, url }: { user: { email: string }; newEmail: string; url: string }) => {
        await sendMail(
          user.email,
          'Confirm your new Plume email',
          `<p>Confirm changing your email to <strong>${newEmail}</strong>:</p><p><a href="${url}">${url}</a></p>`,
        );
      },
    },
    deleteUser: {
      enabled: true,
      beforeDelete: async (user) => {
        await reassignOrDeleteOrgs(user.id);
      },
    },
  },
  plugins: [
    organization({
      organizationHooks: {
        afterCreateOrganization: async ({ organization: org }) => {
          await createStarterProject(org.id).catch(() => undefined);
        },
      },
    }),
  ],
  databaseHooks: {
    user: {
      create: {
        after: (user) => provisionWorkspace(user),
      },
    },
  },
});

export type Auth = typeof auth;
export type Session = typeof auth.$Infer.Session;
export type AuthUser = (typeof auth.$Infer.Session)['user'];
