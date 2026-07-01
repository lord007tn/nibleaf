import { createJob, QueueNames } from '@midad/bullmq';
import { prisma } from '@midad/database';
import { createLogger } from '@midad/logger';
import { joinPath, slugify } from '@midad/shared';
import { betterAuth } from 'better-auth';
import { prismaAdapter } from 'better-auth/adapters/prisma';
import { organization } from 'better-auth/plugins';
import { keys } from './keys.server';

const env = keys();
const log = createLogger({ module: 'auth' });

/** Queue a transactional email; delivery is best-effort (logged without SMTP). */
const sendMail = (to: string, subject: string, html: string) =>
  createJob(QueueNames.EMAIL, { name: 'send-email', data: { to, subject, html } }).catch(() => undefined);

const HTML_ESCAPES: Record<string, string> = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };
const escapeHtml = (value: string) => value.replace(/[&<>"']/g, (char) => HTML_ESCAPES[char] ?? char);

/** Workspace notification prefs are a JSON blob on Organization.metadata. Default ON. */
function notificationEnabled(metadata: string | null | undefined, id: string): boolean {
  if (!metadata) {
    return true;
  }
  try {
    const parsed = JSON.parse(metadata) as { notifications?: Record<string, boolean> };
    return parsed.notifications?.[id] !== false;
  } catch {
    return true;
  }
}

/** Account-level events (sign-in, password change) aren't tied to one workspace, so
 *  honor the toggle across the user's orgs: send unless silenced everywhere they belong. */
async function userNotificationEnabled(userId: string, id: string): Promise<boolean> {
  const memberships = await prisma.member.findMany({ where: { userId }, select: { organization: { select: { metadata: true } } } });
  if (memberships.length === 0) {
    return true;
  }
  return memberships.some((m) => notificationEnabled(m.organization.metadata, id));
}

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

const WELCOME_CONTENT = `This is your first page, built with **Midad** — the open-source documentation
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

const QUICKSTART_CONTENT = `Get your documentation live in minutes.

## Install

\`\`\`bash
git clone https://github.com/midad-docs/midad
cd midad && cp .env.example .env
docker compose up -d
\`\`\`

## Write

Pages are Markdown/MDX. Organize them into groups, reorder with drag handles,
and Midad builds the navigation, search index, and table of contents for you.
`;

const SELF_HOSTING_CONTENT = `Run Midad on infrastructure you control. The standard stack uses Docker Compose
for the dashboard, API, worker, Postgres, Dragonfly, and S3-compatible object
storage.

## Local stack

\`\`\`bash
cp .env.example .env
docker compose -f docker-compose.dev.yml up -d
pnpm db:deploy
pnpm db:seed
pnpm dev
\`\`\`

Open the dashboard at http://localhost:4310 and sign in with the demo account
created by the seed command.

## Production stack

\`\`\`bash
cp .env.example .env
openssl rand -hex 32
# Put the generated value in BETTER_AUTH_SECRET.
docker compose up -d --build
\`\`\`

Create the first account at /sign-up. Production mode does not seed demo
credentials unless you explicitly enable it.
`;

const CONFIGURATION_CONTENT = `Configure Midad with environment variables in the .env file next to
docker-compose.yml.

## Required production values

| Variable | Purpose |
| --- | --- |
| NODE_ENV | Set to production for production deploys. |
| BETTER_AUTH_SECRET | Strong random auth secret. |
| POSTGRES_PASSWORD | Password for bundled Postgres. |
| STORAGE_ACCESS_KEY | Access key for bundled object storage. |
| STORAGE_SECRET_KEY | Secret key for bundled object storage. |
| BETTER_AUTH_URL | Browser-facing dashboard origin. |
| PUBLIC_APP_URL | Public dashboard origin. |
| PUBLIC_API_URL | Public API origin, usually the dashboard proxy. |
| PUBLIC_WWW_URL | Public marketing/root website origin. |
| STORAGE_PUBLIC_URL | Public asset URL. |

## Origins

Set TRUSTED_ORIGINS and CORS_ALLOWED_ORIGINS to exact HTTPS origins. Avoid
wildcards in production.

## Storage

The bundled stack uses maxio. You can also point Midad at Cloudflare R2, AWS S3,
Backblaze B2, or another S3-compatible provider.
`;

const OPERATIONS_CONTENT = `Keep Postgres and object storage backed up, monitor worker jobs, and verify
publishing after upgrades.

## Health checks

- API: /health on the server service.
- Worker: /health on the worker ops service.
- Jobs: /jobs on the worker ops service.
- Public docs: open a published site and search for a known page.

## Upgrade routine

1. Back up Postgres and object storage.
2. Pull the new source revision or image.
3. Run migrations.
4. Restart app, server, worker, and www.
5. Publish a small docs change to verify queues and search indexing.

## Publish troubleshooting

If a publish does not become READY, check worker logs, Dragonfly connectivity,
Postgres connectivity, and storage credentials.
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
  const selfHostingSlug = slugify('Self-hosting');
  const selfHosting = await prisma.page.create({
    data: {
      projectId: project.id,
      languageId: language.id,
      kind: 'GROUP',
      title: 'Self-hosting',
      slug: selfHostingSlug,
      path: joinPath(null, selfHostingSlug),
      icon: 'server',
      position: 2,
    },
  });
  const overview = slugify('Overview');
  const configuration = slugify('Configuration');
  const operations = slugify('Operations');
  await prisma.page.createMany({
    data: [
      {
        projectId: project.id,
        languageId: language.id,
        parentId: selfHosting.id,
        title: 'Overview',
        slug: overview,
        path: joinPath(selfHosting.path, overview),
        icon: 'container',
        content: SELF_HOSTING_CONTENT,
        position: 0,
      },
      {
        projectId: project.id,
        languageId: language.id,
        parentId: selfHosting.id,
        title: 'Configuration',
        slug: configuration,
        path: joinPath(selfHosting.path, configuration),
        icon: 'settings',
        content: CONFIGURATION_CONTENT,
        position: 1,
      },
      {
        projectId: project.id,
        languageId: language.id,
        parentId: selfHosting.id,
        title: 'Operations',
        slug: operations,
        path: joinPath(selfHosting.path, operations),
        icon: 'activity',
        content: OPERATIONS_CONTENT,
        position: 2,
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
      await sendMail(user.email, 'Reset your Midad password', `<p>Click to reset your password:</p><p><a href="${url}">${url}</a></p>`);
    },
  },
  emailVerification: {
    sendVerificationEmail: async ({ user, url }) => {
      await sendMail(
        user.email,
        'Verify your Midad email',
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
          'Confirm your new Midad email',
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
        // Someone accepted an invite (members added via the org API → joins). Tell the
        // workspace's existing owners/admins, unless `member_joined` is disabled.
        afterAddMember: async ({ member, user, organization: org }) => {
          try {
            if (!notificationEnabled((org as { metadata?: string | null }).metadata, 'member_joined')) {
              return;
            }
            const admins = await prisma.member.findMany({
              where: { organizationId: org.id, role: { in: ['owner', 'admin'] }, userId: { not: member.userId } },
              select: { user: { select: { email: true } } },
            });
            const who = user.name || user.email || 'A new member';
            const subject = `${who} joined ${org.name}`;
            const html = `<div style="font-family:system-ui,sans-serif;max-width:480px;margin:0 auto;color:#0f172a"><h2 style="font-size:18px;margin:0 0 12px">New teammate in ${escapeHtml(org.name)}</h2><p style="margin:0;color:#475569;line-height:1.6"><strong>${escapeHtml(who)}</strong> just joined <strong>${escapeHtml(org.name)}</strong>.</p></div>`;
            await Promise.all(admins.map((a) => (a.user.email ? sendMail(a.user.email, subject, html) : undefined)));
          } catch {
            // never block the join
          }
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
    // New sign-in alert — only on a sign-in from an IP we haven't seen for this user
    // (a new device/location), so routine logins don't spam. Honors `security_login`.
    session: {
      create: {
        after: async (session) => {
          try {
            const known = await prisma.session.count({
              where: { userId: session.userId, id: { not: session.id }, ...(session.ipAddress ? { ipAddress: session.ipAddress } : {}) },
            });
            if (known > 0) {
              return;
            }
            if (!(await userNotificationEnabled(session.userId, 'security_login'))) {
              return;
            }
            const user = await prisma.user.findUnique({ where: { id: session.userId }, select: { email: true } });
            if (!user?.email) {
              return;
            }
            const where = session.ipAddress ? ` from a new location (IP ${escapeHtml(session.ipAddress)})` : ' from a new device';
            await sendMail(
              user.email,
              'New sign-in to your Midad account',
              `<div style="font-family:system-ui,sans-serif;max-width:480px;margin:0 auto;color:#0f172a"><h2 style="font-size:18px;margin:0 0 12px">New sign-in detected</h2><p style="margin:0;color:#475569;line-height:1.6">We noticed a new sign-in to your account${where}. If this was you, you can ignore this email — otherwise change your password right away.</p></div>`,
            );
          } catch {
            // never block sign-in
          }
        },
      },
    },
    // Password-changed alert — credential-account updates are password changes for an
    // email/password user (logins create sessions, not account rows). Honors `security_password`.
    account: {
      update: {
        after: async (account) => {
          try {
            if (account.providerId !== 'credential') {
              return;
            }
            if (!(await userNotificationEnabled(account.userId, 'security_password'))) {
              return;
            }
            const user = await prisma.user.findUnique({ where: { id: account.userId }, select: { email: true } });
            if (!user?.email) {
              return;
            }
            await sendMail(
              user.email,
              'Your Midad password was changed',
              `<div style="font-family:system-ui,sans-serif;max-width:480px;margin:0 auto;color:#0f172a"><h2 style="font-size:18px;margin:0 0 12px">Password changed</h2><p style="margin:0;color:#475569;line-height:1.6">Your account password was just changed. If this wasn't you, reset your password immediately and review your active sessions.</p></div>`,
            );
          } catch {
            // never block the password update
          }
        },
      },
    },
  },
});

export type Auth = typeof auth;
export type Session = typeof auth.$Infer.Session;
export type AuthUser = (typeof auth.$Infer.Session)['user'];
