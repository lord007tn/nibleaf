import { createJob, QueueNames } from '@plume/bullmq';
import { prisma } from '@plume/database';
import { joinPath, slugify } from '@plume/shared';
import { betterAuth } from 'better-auth';
import { prismaAdapter } from 'better-auth/adapters/prisma';
import { organization } from 'better-auth/plugins';
import { keys } from './keys.server';

const env = keys();

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
  } catch {
    // Never block sign-up on provisioning; the user can create a workspace later.
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
    requireEmailVerification: false,
    sendResetPassword: async ({ user, url }) => {
      await createJob(QueueNames.EMAIL, {
        name: 'send-email',
        data: {
          to: user.email,
          subject: 'Reset your Plume password',
          html: `<p>Click to reset your password:</p><p><a href="${url}">${url}</a></p>`,
        },
      }).catch(() => undefined);
    },
  },
  user: {
    deleteUser: {
      enabled: true,
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
