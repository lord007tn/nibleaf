import { createJob, QueueNames } from '@nibleaf/bullmq';
import type { PublishDeploymentJobData } from '@nibleaf/bullmq/jobs/publish';
import { Prisma, prisma } from '@nibleaf/database';
import { createLogger } from '@nibleaf/logger';
import { joinPath, slugify } from '@nibleaf/shared';
import { betterAuth } from 'better-auth';
import { prismaAdapter } from 'better-auth/adapters/prisma';
import { APIError } from 'better-auth/api';
import { emailOTP, organization } from 'better-auth/plugins';
import { keys } from './keys.server';

const env = keys();
const log = createLogger({ module: 'auth' });

/** Queue a transactional email; delivery is best-effort (logged without a sender). */
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

// ─── Starter site template ───────────────────────────────────────────────────
// A product-docs template for the CUSTOMER's product (not Nibleaf's own docs):
// each page demonstrates a slice of the editor/MDX toolkit and is written to be
// replaced. Keep internal links pointing at pages that exist in this template —
// the publish-time broken-link check runs against the starter too.

const GETTING_STARTED_CONTENT = `Welcome to your new documentation site. Everything you read here is a regular
page — edit it, replace it, or delete it. This starter shows what your docs can
do, so your first edits feel natural.

## Edit this page

1. Click anywhere in the text and start typing — the editor is a Notion-style
   editor over plain Markdown.
2. Type \`/\` on an empty line to insert callouts, code blocks, tabs, and more.
3. Changes save automatically as drafts. Nothing goes live until you publish.

## Publish your site

Hit **Publish** in the top bar to ship a snapshot of your docs as a live,
searchable site. This starter was published for you at sign-up, so your site is
already live — each publish after this replaces it, and you can roll back to
any earlier version.

<Note>

Write about **your** product here. A good first edit: rename this page, then
describe what your product does in one paragraph.

</Note>

## Explore the starter

<CardGroup cols="2">

<Card title="Installation" href="/installation" icon="download">

Show users how to install your product with tabs and step-by-step guides.

</Card>

<Card title="Components tour" href="/components-tour" icon="puzzle">

Steps, tabs, callouts, cards, and accordions — everything in your toolkit.

</Card>

<Card title="API reference" href="/api-reference/create-a-widget" icon="code">

Document endpoints with parameter and response fields.

</Card>

<Card title="FAQ" href="/faq" icon="help-circle">

Answer common questions with accordions.

</Card>

</CardGroup>
`;

const INSTALLATION_CONTENT = `Replace this page with real installation instructions for your product. It
demonstrates the two building blocks most install guides need: tabs for
package managers and steps for a walkthrough.

## Install the package

<Tabs>

<Tab title="npm">

\`\`\`bash
npm install @acme/sdk
\`\`\`

</Tab>

<Tab title="pnpm">

\`\`\`bash
pnpm add @acme/sdk
\`\`\`

</Tab>

<Tab title="yarn">

\`\`\`bash
yarn add @acme/sdk
\`\`\`

</Tab>

</Tabs>

## Set up your project

<Steps>

<Step title="Grab an API key">

Create a key in your product's dashboard and keep it secret — treat it like a
password.

</Step>

<Step title="Configure the client">

\`\`\`ts title="acme.ts"
import { Acme } from '@acme/sdk';

export const acme = new Acme({ apiKey: process.env.ACME_API_KEY });
\`\`\`

</Step>

<Step title="Make your first call">

\`\`\`ts
const widget = await acme.widgets.create({ name: 'My first widget' });
console.log(widget.id);
\`\`\`

</Step>

</Steps>

<Tip>

Swap \`@acme/sdk\` for your real package name. Code blocks support syntax
highlighting for dozens of languages, plus a \`title="file.ts"\` header.

</Tip>

Next: document your API in the [API reference](/api-reference/create-a-widget).
`;

const COMPONENTS_TOUR_CONTENT = `Every component on this page works in the editor today — copy the patterns you
like into your own pages, then delete this tour.

## Callouts

<Note>

A **Note** for neutral asides. There are also \`<Info>\`, \`<Tip>\`, \`<Check>\`,
\`<Warning>\`, and \`<Danger>\` variants.

</Note>

<Warning>

A **Warning** for things that break when readers skip them.

</Warning>

## Steps

<Steps>

<Step title="Write">

Draft pages in the editor — plain Markdown underneath, so nothing locks you in.

</Step>

<Step title="Organize">

Drag pages in the sidebar to reorder them, or nest them into groups.

</Step>

<Step title="Publish">

Ship a new version of the live site whenever you are ready.

</Step>

</Steps>

## Tabs

<Tabs>

<Tab title="macOS">

Content per platform, per language, per anything.

</Tab>

<Tab title="Windows">

Each tab holds full Markdown — lists, code blocks, images.

</Tab>

</Tabs>

## Cards

<CardGroup cols="2">

<Card title="Link card" href="/faq" icon="help-circle">

Cards can link to other pages or external URLs.

</Card>

<Card title="Plain card" icon="box">

Or just hold content in a tidy grid.

</Card>

</CardGroup>

## Accordions

<AccordionGroup>

<Accordion title="When should I use an accordion?">

For optional detail readers should not have to scroll past — edge cases,
advanced configuration, long FAQ answers.

</Accordion>

<Accordion title="Can accordions hold other components?">

Yes — accordions hold full Markdown, including code blocks and callouts.

</Accordion>

</AccordionGroup>
`;

const API_AUTHENTICATION_CONTENT = `Show readers how to authenticate against your API. This example uses a bearer
token; adapt it to your scheme.

All requests must include your API key in the \`Authorization\` header:

<CodeGroup>

\`\`\`bash title="cURL"
curl https://api.example.com/v1/widgets \\
  -H "Authorization: Bearer $ACME_API_KEY"
\`\`\`

\`\`\`ts title="TypeScript"
const res = await fetch('https://api.example.com/v1/widgets', {
  headers: { Authorization: \`Bearer \${process.env.ACME_API_KEY}\` },
});
\`\`\`

\`\`\`python title="Python"
import requests

res = requests.get(
    "https://api.example.com/v1/widgets",
    headers={"Authorization": f"Bearer {API_KEY}"},
)
\`\`\`

</CodeGroup>

<Warning>

Never ship API keys in client-side code. Call your API from a server and keep
keys in environment variables.

</Warning>
`;

const API_CREATE_WIDGET_CONTENT = `A worked example of an endpoint page. Duplicate it for each endpoint in your
API, or delete the group if you do not document an API.

## POST /v1/widgets

Creates a widget and returns it.

### Body parameters

<ParamField body="name" type="string" required="true">

A human-readable name, 1-80 characters.

</ParamField>

<ParamField body="color" type="string" default="terracotta">

Any CSS color keyword or hex value.

</ParamField>

<ParamField body="tags" type="string[]">

Up to 10 tags used for filtering in list endpoints.

</ParamField>

### Response

<ResponseField name="id" type="string" required="true">

Unique identifier, prefixed with \`wid_\`.

</ResponseField>

<ResponseField name="name" type="string" required="true">

The name you supplied.

</ResponseField>

<ResponseField name="createdAt" type="string">

ISO 8601 creation timestamp.

</ResponseField>

### Example

<CodeGroup>

\`\`\`bash title="Request"
curl -X POST https://api.example.com/v1/widgets \\
  -H "Authorization: Bearer $ACME_API_KEY" \\
  -H "Content-Type: application/json" \\
  -d '{ "name": "My first widget" }'
\`\`\`

\`\`\`json title="Response"
{
  "id": "wid_1a2b3c",
  "name": "My first widget",
  "createdAt": "2026-07-10T12:00:00Z"
}
\`\`\`

</CodeGroup>

See [Authentication](/api-reference/authentication) for how to get a key.
`;

const FAQ_CONTENT = `A pattern for frequently asked questions — accordions keep long answer lists
scannable. Replace these with questions about your product.

<AccordionGroup>

<Accordion title="How do I change what visitors see?">

Edit any page, then hit **Publish**. The live site only updates when you
publish, so drafts stay private.

</Accordion>

<Accordion title="How do I add a page?">

Use the add button in the sidebar. Drag pages to reorder them, or drop one
onto another to nest it inside a group.

</Accordion>

<Accordion title="Can I write in more than one language?">

Yes — add languages in project settings. Each language keeps its own page
tree, and right-to-left languages such as Arabic are fully supported.

</Accordion>

<Accordion title="Can I use my own domain?">

Yes — add a custom domain in project settings and follow the DNS
instructions.

</Accordion>

<Accordion title="Where does this starter content come from?">

Your docs run on Nibleaf, an open-source, self-hostable documentation
platform — an alternative to Mintlify and GitBook. Source at
[github.com/lord007tn/nibleaf](https://github.com/lord007tn/nibleaf), hosted
cloud at [nibleaf.com](https://nibleaf.com).

</Accordion>

</AccordionGroup>
`;

/** A globally-unique project slug for the starter site. `project.slug` has a
 *  global unique constraint, so a hard-coded `docs` collides for every signup
 *  after the first — leaving new users with an empty workspace. Fall back to
 *  `docs-2`, `docs-3`, … and finally a timestamp suffix so provisioning never
 *  fails on the slug. */
async function uniqueStarterSlug(): Promise<string> {
  for (let i = 0; i < 100; i++) {
    const candidate = i === 0 ? 'docs' : `docs-${i + 1}`;
    const clash = await prisma.project.findFirst({ where: { slug: candidate }, select: { id: true } });
    if (!clash) {
      return candidate;
    }
  }
  return `docs-${Date.now().toString(36)}`;
}

/** Create the starter docs site (a customer-product docs template) for a freshly
 *  created workspace. Returns the project so the caller can auto-publish it, or
 *  null when the workspace already has one. */
async function createStarterProject(organizationId: string): Promise<{ id: string } | null> {
  const existing = await prisma.project.findFirst({ where: { organizationId }, select: { id: true } });
  if (existing) {
    return null;
  }
  // `project.slug` is globally unique and `uniqueStarterSlug()` only pre-checks —
  // a concurrent signup can grab the same slug between the check and the create
  // (TOCTOU). Retry on the unique-constraint violation, re-rolling the slug each
  // time, and fall back to a timestamped slug so provisioning never fails here.
  const createProjectWithInvariants = async () => {
    for (let attempt = 0; attempt < 5; attempt++) {
      const slug = attempt < 4 ? await uniqueStarterSlug() : `docs-${Date.now().toString(36)}`;
      try {
        return await prisma.$transaction(async (tx) => {
          const project = await tx.project.create({
            data: { organizationId, name: 'Documentation', slug, description: 'Your first documentation site.' },
          });
          const language = await tx.language.create({
            data: { projectId: project.id, code: 'en', label: 'English', direction: 'LTR', isDefault: true, position: 0 },
          });
          const branch = await tx.branch.create({ data: { projectId: project.id, name: 'main', isDefault: true } });
          return { project, language, branch };
        });
      } catch (error) {
        const isSlugConflict =
          error instanceof Prisma.PrismaClientKnownRequestError &&
          error.code === 'P2002' &&
          (error.meta?.target as string[] | string | undefined)?.includes('slug');
        if (!isSlugConflict || attempt === 4) {
          throw error;
        }
      }
    }
    // Unreachable: the final attempt either returns or throws.
    throw new Error('Failed to allocate a unique starter project slug.');
  };
  // The project and its required default language/branch commit atomically, so
  // no request can observe a project that violates the page/snapshot contract.
  const { project, language, branch } = await createProjectWithInvariants();
  const base = { projectId: project.id, languageId: language.id, branchId: branch.id };
  const topLevel: Array<{ title: string; icon: string; content: string; position: number }> = [
    { title: 'Getting started', icon: 'rocket', content: GETTING_STARTED_CONTENT, position: 0 },
    { title: 'Installation', icon: 'download', content: INSTALLATION_CONTENT, position: 1 },
    { title: 'Components tour', icon: 'puzzle', content: COMPONENTS_TOUR_CONTENT, position: 2 },
  ];
  await prisma.page.createMany({
    data: topLevel.map((page) => {
      const slug = slugify(page.title);
      return { ...base, title: page.title, slug, path: joinPath(null, slug), icon: page.icon, content: page.content, position: page.position };
    }),
  });
  const apiReferenceSlug = slugify('API reference');
  const apiReference = await prisma.page.create({
    data: {
      ...base,
      kind: 'GROUP',
      title: 'API reference',
      slug: apiReferenceSlug,
      path: joinPath(null, apiReferenceSlug),
      icon: 'code',
      position: 3,
    },
  });
  const apiChildren: Array<{ title: string; icon: string; content: string; position: number }> = [
    { title: 'Authentication', icon: 'key', content: API_AUTHENTICATION_CONTENT, position: 0 },
    { title: 'Create a widget', icon: 'sparkles', content: API_CREATE_WIDGET_CONTENT, position: 1 },
  ];
  await prisma.page.createMany({
    data: apiChildren.map((page) => {
      const slug = slugify(page.title);
      return {
        ...base,
        parentId: apiReference.id,
        title: page.title,
        slug,
        path: joinPath(apiReference.path, slug),
        icon: page.icon,
        content: page.content,
        position: page.position,
      };
    }),
  });
  const faqSlug = slugify('FAQ');
  await prisma.page.create({
    data: { ...base, title: 'FAQ', slug: faqSlug, path: joinPath(null, faqSlug), icon: 'help-circle', content: FAQ_CONTENT, position: 4 },
  });
  return project;
}

/** Fire-and-forget platform product event (activation funnel). Never throws. */
const logPlatformEvent = (type: string, data: { userId?: string; projectId?: string; metadata?: Record<string, unknown> }) =>
  prisma.platformEvent
    .create({
      data: {
        type,
        userId: data.userId ?? null,
        projectId: data.projectId ?? null,
        ...(data.metadata ? { metadata: data.metadata as Prisma.InputJsonValue } : {}),
      },
    })
    .catch(() => undefined);

/**
 * Auto-publish the freshly seeded starter site so "view site" works immediately
 * after sign-up (instead of a 404 until the user finds the Publish button).
 * Mirrors createDeployment in apps/server/src/actions/deployments.ts: a unique
 * (projectId, version) PENDING row, then a PUBLISH job for the worker. Best
 * effort — a failure logs a warning and never blocks provisioning.
 */
/** Sign-up must never wait on the queue. Producer connections reject fast when
 *  redis is down (packages/bullmq producerConnectionConfig), but a *stalled*
 *  connected socket could still hang, so cap the wait explicitly. */
const ENQUEUE_TIMEOUT_MS = 3_000;

const withTimeout = <T>(promise: Promise<T>, ms: number): Promise<T> =>
  new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`enqueue timed out after ${ms}ms`)), ms);
    promise.then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      (error) => {
        clearTimeout(timer);
        reject(error);
      },
    );
  });

async function publishStarterSite(projectId: string, userId: string): Promise<void> {
  try {
    const last = await prisma.deployment.aggregate({ where: { projectId }, _max: { version: true } });
    const deployment = await prisma.deployment.create({
      data: {
        projectId,
        version: (last._max.version ?? 0) + 1,
        status: 'PENDING',
        createdById: userId,
        commitMessage: 'Publish starter site',
      },
    });
    // `auto: true` marks this as a system publish for the activation funnel;
    // user-initiated publishes send `auto: false`.
    const jobData: PublishDeploymentJobData = { deploymentId: deployment.id, projectId, auto: true };
    await withTimeout(createJob(QueueNames.PUBLISH, { name: 'publish-deployment', data: jobData }), ENQUEUE_TIMEOUT_MS);
    await logPlatformEvent('publish_clicked', { userId, projectId, metadata: { auto: true } });
  } catch (error) {
    log.warn({ error, projectId }, 'starter site auto-publish failed; the user can publish manually');
  }
}

/** Auto-provision a workspace + starter project so a new user lands in a usable app. */
async function provisionWorkspace(user: { id: string; name?: string | null; email: string }): Promise<void> {
  try {
    const existing = await prisma.member.findFirst({ where: { userId: user.id } });
    if (existing) {
      return;
    }
    // An invited owner/member already has a destination workspace. Creating an
    // unrelated starter workspace here would leave them with two sites as soon
    // as they accept the invitation.
    const pendingInvitation = await prisma.invitation.findFirst({
      where: { email: user.email.trim().toLowerCase(), status: 'pending', expiresAt: { gt: new Date() } },
      select: { id: true },
    });
    if (pendingInvitation) {
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
    await logPlatformEvent('signup_completed', { userId: user.id });
    const project = await createStarterProject(org.id);
    if (project) {
      await publishStarterSite(project.id, user.id);
    }
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
  socialProviders:
    env.GOOGLE_CLIENT_ID && env.GOOGLE_CLIENT_SECRET
      ? {
          google: {
            clientId: env.GOOGLE_CLIENT_ID,
            clientSecret: env.GOOGLE_CLIENT_SECRET,
            // Honor DISABLE_SIGNUP for social sign-in too: existing users keep
            // signing in with Google, but no new accounts are created.
            disableSignUp: env.DISABLE_SIGNUP,
          },
        }
      : undefined,
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
    // DISABLE_SIGNUP=true refuses new email/password accounts while existing
    // users keep signing in (closed self-hosts, or an emergency cloud brake).
    disableSignUp: env.DISABLE_SIGNUP,
    // Off by default (private self-host without SMTP); set REQUIRE_EMAIL_VERIFICATION=true
    // for public instances. The verify-email UI + resend then work via the queue below.
    requireEmailVerification: env.REQUIRE_EMAIL_VERIFICATION,
    sendResetPassword: async ({ user, url }) => {
      await sendMail(user.email, 'Reset your Nibleaf password', `<p>Click to reset your password:</p><p><a href="${url}">${url}</a></p>`);
    },
  },
  emailVerification: {
    sendVerificationEmail: async ({ user, url }) => {
      await sendMail(
        user.email,
        'Verify your Nibleaf email',
        `<p>Confirm your email to finish setting up your account:</p><p><a href="${url}">${url}</a></p>`,
      );
    },
  },
  user: {
    changeEmail: {
      enabled: true,
    },
    deleteUser: {
      enabled: true,
      beforeDelete: async (user) => {
        await reassignOrDeleteOrgs(user.id);
      },
    },
  },
  plugins: [
    emailOTP({
      // Admin sign-in is passwordless. Keep this endpoint account-only so a
      // mistyped address can never create a customer or admin account.
      disableSignUp: true,
      expiresIn: 10 * 60,
      allowedAttempts: 5,
      storeOTP: 'hashed',
      async sendVerificationOTP({ email, otp, type }) {
        const purpose = type === 'sign-in' ? 'sign in' : type === 'forget-password' ? 'reset your password' : 'verify your email';
        const subject = type === 'sign-in' ? 'Your Nibleaf Admin sign-in code' : `Your Nibleaf code to ${purpose}`;
        const html = `<div style="font-family:system-ui,-apple-system,Segoe UI,Roboto,sans-serif;max-width:480px;margin:0 auto;color:#0f172a">
  <h2 style="font-size:20px;margin:0 0 12px">Your Nibleaf code</h2>
  <p style="margin:0 0 18px;color:#475569;line-height:1.6">Use this one-time code to ${purpose}. It expires in 10 minutes.</p>
  <div style="display:inline-block;padding:14px 20px;border-radius:10px;background:#f1f5f9;font:700 28px/1 ui-monospace,SFMono-Regular,Menlo,monospace;letter-spacing:0.24em;color:#0f172a">${escapeHtml(otp)}</div>
  <p style="margin:20px 0 0;color:#94a3b8;font-size:12px;line-height:1.5">If you did not request this code, you can safely ignore this email.</p>
</div>`;
        // Do not make the auth response timing depend on the mail provider.
        void sendMail(email, subject, html);
      },
    }),
    organization({
      organizationHooks: {
        afterCreateOrganization: async ({ organization: org, member }) => {
          const project = await createStarterProject(org.id).catch(() => null);
          if (project) {
            await publishStarterSite(project.id, member.userId);
          }
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
        // Suspended accounts must not get new sessions (moderation). Existing
        // sessions are revoked at suspension time; the API guard is the backstop.
        before: async (session) => {
          const target = await prisma.user.findUnique({ where: { id: session.userId }, select: { suspendedAt: true } });
          if (target?.suspendedAt) {
            throw new APIError('FORBIDDEN', {
              message: 'This account has been suspended. Contact support@nibleaf.com if you believe this is a mistake.',
            });
          }
          return { data: session };
        },
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
              'New sign-in to your Nibleaf account',
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
              'Your Nibleaf password was changed',
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
