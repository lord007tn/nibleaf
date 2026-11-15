import { createJob, QueueNames, sendRequiredEmail } from '@nibleaf/bullmq';
import { AUTH_OTP_EXPIRY_SECONDS, type SendEmailJobData } from '@nibleaf/bullmq/jobs/email';
import type { PublishDeploymentJobData } from '@nibleaf/bullmq/jobs/publish';
import { assignDefaultUsagePlan, Prisma, prisma } from '@nibleaf/database';
import {
  createEmailTranslator,
  type RenderedEmail,
  renderMemberJoinedEmail,
  renderNewSignInEmail,
  renderVerificationCodeEmail,
  resolveEmailLanguage,
} from '@nibleaf/email';
import { resolveRequestLocale } from '@nibleaf/i18n/locales';
import { createLogger } from '@nibleaf/logger';
import { joinPath, slugify } from '@nibleaf/shared';
import { addonDefinitions, defaultProjectAddonProvisioning, projectConfigWithAddons } from '@nibleaf/shared/addons';
import { TERMS_VERSION } from '@nibleaf/shared/legal';
import { THEME_PRESETS, THEME_SCHEMA_VERSION } from '@nibleaf/shared/themes';
import { betterAuth } from 'better-auth';
import { prismaAdapter } from 'better-auth/adapters/prisma';
import { APIError, addOAuthServerContext, createAuthMiddleware, getOAuthState } from 'better-auth/api';
import { admin, emailOTP, organization } from 'better-auth/plugins';
import { reassignOrDeleteOrgs } from './account-deletion';
import { requireAuthEmailEnqueue, trackRequiredAuthEmail, withRequiredAuthEmailScope } from './auth-email-delivery';
import { deliverAuthOtpEmail } from './auth-email-expiry';
import { arrivingThroughJoinLink, revokeJoinLinksBeyondRole } from './join-links';
import { keys } from './keys.server';
import { createMcpAccessTokenVerifier, MCP_OAUTH_DISABLED_PATHS, mcpOAuthPlugins, resolveMcpOAuthConfig } from './mcp-oauth';
import { organizationMetadataResponseFilter } from './organization-metadata';
import { ORGANIZATION_DISABLED_PATHS } from './organization-paths';
import { googleOAuthEnabled } from './providers';
import {
  STARTER_API_AUTHENTICATION_CONTENT as API_AUTHENTICATION_CONTENT,
  STARTER_API_CREATE_WIDGET_CONTENT as API_CREATE_WIDGET_CONTENT,
  STARTER_COMPONENTS_TOUR_CONTENT as COMPONENTS_TOUR_CONTENT,
  STARTER_FAQ_CONTENT as FAQ_CONTENT,
  STARTER_GETTING_STARTED_CONTENT as GETTING_STARTED_CONTENT,
  STARTER_INSTALLATION_CONTENT as INSTALLATION_CONTENT,
  STARTER_GETTING_STARTED_ICON,
  STARTER_GETTING_STARTED_TITLE,
} from './starter-content';
import { starterOrganizationName } from './starter-organization';
import { pickStarterSlug, starterFallbackSlug } from './starter-slug';

const env = keys();
const log = createLogger({ module: 'auth' });
const termsRequired = () => new APIError('BAD_REQUEST', { code: 'TERMS_REQUIRED', message: 'Accept the terms, then request a new code.' });

const captureGoogleTerms = createAuthMiddleware(async (context) => {
  if (context.path !== '/sign-in/social' || context.body?.provider !== 'google') return;
  const accepted = context.body?.additionalData?.acceptTerms;
  // Without acknowledgement an existing account can still log in. Only the
  // verified identity at creation can distinguish a new account safely.
  if (accepted === undefined || accepted === false) return;
  if (accepted !== true) throw termsRequired();
  await addOAuthServerContext({ termsVersion: TERMS_VERSION });
});

/** OAuth for MCP clients, or null when MCP is off or the public URL cannot
 *  host an OAuth 2.1 server (plain HTTP outside loopback). */
export const mcpOAuth = resolveMcpOAuthConfig(env);
if (env.MCP_ENABLED && !mcpOAuth) {
  log.warn('MCP OAuth sign-in is off: BETTER_AUTH_URL must be HTTPS (or a loopback URL in development). API keys still work.');
}

const sanitizeEmailErrorField = (value: string) => value.replace(/https?:\/\/[^\s"'<>]+/gi, '[redacted-url]').slice(0, 500);

const safeEmailError = (error: unknown) => ({
  name: error instanceof Error ? sanitizeEmailErrorField(error.name) : 'UnknownError',
  message: sanitizeEmailErrorField(error instanceof Error ? error.message : String(error)),
});

/** Queue a transactional email; delivery is best-effort (logged without a sender). */
const sendMail = (to: string, email: RenderedEmail, teamAccess?: SendEmailJobData['teamAccess']) =>
  createJob(QueueNames.EMAIL, { name: 'send-email', data: { to, ...email, ...(teamAccess ? { teamAccess } : {}) } }).catch((error) => {
    log.warn({ error: safeEmailError(error) }, 'transactional email enqueue failed');
  });

/** Report success only after the worker confirms provider acceptance. */
async function deliverRequiredAuthEmail(to: string, email: Promise<RenderedEmail>, auth: SendEmailJobData['auth']): Promise<void> {
  try {
    const message = await email;
    await withTimeout(sendRequiredEmail({ to, ...message, auth }), 15_000);
  } catch (error) {
    log.error({ error: safeEmailError(error) }, 'required auth email delivery failed');
    throw error;
  }
}

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

// ─── Starter site template ───────────────────────────────────────────────────
// A product-docs template for the CUSTOMER's product (not Nibleaf's own docs):
// each page demonstrates a slice of the editor/MDX toolkit and is written to be
// replaced. Keep internal links pointing at pages that exist in this template —
// the publish-time broken-link check runs against the starter too.
// The pages' contents are in starter-content.ts.

/** A globally-unique, non-reserved project slug for the starter site.
 *  `project.slug` has a global unique constraint, so every signup after the
 *  first falls through to a numbered or random address (see `./starter-slug`). */
const uniqueStarterSlug = () => pickStarterSlug(async (slug) => (await prisma.project.findFirst({ where: { slug }, select: { id: true } })) !== null);

/** Create the starter docs site (a customer-product docs template) for a freshly
 *  created workspace. Returns the project so the caller can auto-publish it, or
 *  null when the workspace already has one. */
async function createStarterProject(organizationId: string, actorUserId: string): Promise<{ id: string } | null> {
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
      const slug = attempt < 4 ? await uniqueStarterSlug() : starterFallbackSlug();
      try {
        return await prisma.$transaction(async (tx) => {
          // Project.dataTenantId gets an independent cuid from the Prisma default (§3).
          const project = await tx.project.create({
            data: {
              organizationId,
              name: 'Documentation',
              slug,
              description: 'Your first documentation site.',
              // Seed the curated default preset (same as createProject in the
              // API) so the starter site never renders the legacy accent-only
              // palette; a stored `theme` opts the site into the theme resolver.
              config: projectConfigWithAddons(
                { theme: { version: THEME_SCHEMA_VERSION, preset: 'harbor', metadata: THEME_PRESETS.harbor.metadata } },
                addonDefinitions.map((definition) => ({
                  key: definition.id,
                  enabled: definition.defaultEnabled,
                  config: definition.defaultConfig,
                })),
              ) as Prisma.InputJsonValue,
            },
          });
          const defaultAddons = defaultProjectAddonProvisioning(project.id, actorUserId);
          await tx.projectAddon.createMany({
            data: defaultAddons.addons.map((addon) => ({ ...addon, config: addon.config as Prisma.InputJsonValue })),
          });
          await tx.projectAddonAuditEvent.createMany({
            data: defaultAddons.auditEvents.map((event) => ({ ...event, nextConfig: event.nextConfig as Prisma.InputJsonValue })),
          });
          const language = await tx.language.create({
            data: { projectId: project.id, code: 'en', label: 'English', direction: 'LTR', isDefault: true, position: 0 },
          });
          const branch = await tx.branch.create({ data: { projectId: project.id, name: 'main', isDefault: true }, omit: { forkBaseline: true } });
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
    { title: STARTER_GETTING_STARTED_TITLE, icon: STARTER_GETTING_STARTED_ICON, content: GETTING_STARTED_CONTENT, position: 0 },
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
const ENQUEUE_TIMEOUT_MS = 3000;

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

async function publishStarterSite(projectId: string, userId: string, locale?: string): Promise<void> {
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
    const jobData: PublishDeploymentJobData = { deploymentId: deployment.id, projectId, auto: true, locale };
    await withTimeout(createJob(QueueNames.PUBLISH, { name: 'publish-deployment', data: jobData }), ENQUEUE_TIMEOUT_MS);
    await logPlatformEvent('publish_clicked', { userId, projectId, metadata: { auto: true } });
  } catch (error) {
    log.warn({ error, projectId }, 'starter site auto-publish failed; the user can publish manually');
  }
}

type JoinedOrganization = { id: string; name: string; metadata?: string | null };

/**
 * Someone joined a site (accepted an invitation, or used a join link). Every
 * existing member sees it in the bell inbox; owners and admins also get an
 * email. Honours the site's `member_joined` notification toggle and never
 * throws: a join must not fail because a notification did.
 */
export async function notifyMemberJoined({
  organization: org,
  projectId,
  userId,
  user,
}: {
  projectId: string;
  organization: JoinedOrganization;
  userId: string;
  user: { name?: string | null; email?: string | null };
}): Promise<void> {
  try {
    if (!notificationEnabled(org.metadata, 'member_joined')) {
      return;
    }
    const who = user.name || user.email || 'A new member';
    const project = await prisma.project.findUnique({
      where: { id: projectId, organizationId: org.id },
      select: { id: true, languages: { where: { isDefault: true }, select: { code: true }, take: 1 } },
    });
    if (!project) return;
    const language = resolveEmailLanguage(project.languages[0]?.code);
    // In-app bell: every existing member sees the join (the email below stays
    // admin-only). Each site owns its org 1:1, so the org's project is the link target.
    try {
      const others = await prisma.member.findMany({
        where: {
          organizationId: org.id,
          userId: { not: userId },
          user: { banned: false, suspendedAt: null },
          OR: [{ orgRole: { in: ['owner', 'admin'] } }, { orgRole: 'member', projectGrants: { some: { projectId } } }],
        },
        select: { userId: true },
      });
      const notificationT = createEmailTranslator(language);
      if (others.length > 0) {
        await prisma.notification.createMany({
          data: others.map((existing) => ({
            userId: existing.userId,
            projectId: project?.id ?? null,
            type: 'member_joined',
            title: notificationT('email.memberJoined.title', { memberName: who, organizationName: org.name }),
            body: notificationT('email.memberJoined.message', { memberName: who, organizationName: org.name }),
            href: project ? `/app/projects/${project.id}/settings?section=members` : null,
          })),
        });
      }
    } catch {
      // in-app inbox is best-effort; fall through to the email
    }
    const admins = await prisma.member.findMany({
      where: {
        organizationId: org.id,
        userId: { not: userId },
        user: { banned: false, suspendedAt: null },
        OR: [{ orgRole: { in: ['owner', 'admin'] } }, { orgRole: 'member', projectGrants: { some: { projectId, role: 'admin' } } }],
      },
      select: { userId: true, user: { select: { email: true } } },
    });
    const email = await renderMemberJoinedEmail({
      memberName: who,
      organizationName: org.name,
      language,
    });
    await Promise.all(
      admins.map((admin) =>
        admin.user.email
          ? sendMail(admin.user.email, email, { userId: admin.userId, projectId, minimumRole: 'admin', notificationId: 'member_joined' })
          : undefined,
      ),
    );
  } catch {
    // never block the join
  }
}

/** Auto-provision a workspace + starter project so a new user lands in a usable app. */
async function provisionWorkspace(user: { id: string; name?: string | null; email: string }, locale?: string, headers?: Headers): Promise<void> {
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
    // Someone signing up from a site's join link joins THAT site next; an
    // unrelated starter workspace would leave them with two. Only a link that
    // would actually admit this address counts (see arrivingThroughJoinLink).
    if (await arrivingThroughJoinLink(user.email, headers)) {
      return;
    }
    const org = await prisma.$transaction(async (tx) => {
      const organization = await tx.organization.create({
        data: {
          name: starterOrganizationName(user.name, locale),
          slug: `${slugify(user.email.split('@')[0] ?? 'workspace')}-${Date.now().toString(36)}`,
        },
      });
      await tx.organizationHandle.create({ data: { slug: organization.slug, organizationId: organization.id, current: true } });
      await assignDefaultUsagePlan(tx, organization.id);
      return organization;
    });
    await prisma.member.create({ data: { organizationId: org.id, userId: user.id, role: 'owner', orgRole: 'owner' } });
    await logPlatformEvent('signup_completed', { userId: user.id });
    const project = await createStarterProject(org.id, user.id);
    if (project) {
      await publishStarterSite(project.id, user.id, locale);
    }
  } catch (error) {
    // Never block sign-up on provisioning; the user can create a workspace later.
    // Log it so the failure is diagnosable instead of silently swallowed.
    log.error({ error, userId: user.id }, 'workspace provisioning failed during sign-up');
  }
}

const authInstance = betterAuth({
  database: prismaAdapter(prisma, { provider: 'postgresql' }),
  // Organization access and admissions use our resource-addressed APIs.
  // No plugin read or write may bypass those guards or expose organization metadata.
  disabledPaths: [...ORGANIZATION_DISABLED_PATHS, ...(mcpOAuth ? MCP_OAUTH_DISABLED_PATHS : [])],
  hooks: { before: captureGoogleTerms, after: requireAuthEmailEnqueue },
  secret: env.BETTER_AUTH_SECRET,
  baseURL: env.BETTER_AUTH_URL,
  basePath: '/api/auth',
  socialProviders: googleOAuthEnabled(env)
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
    // Nibleaf is passwordless. Existing credential records may remain in the
    // database for backwards compatibility, but no password endpoint is exposed.
    enabled: false,
  },
  emailVerification: {
    // Verification is completed in-app with the email OTP plugin.
    autoSignInAfterVerification: true,
    sendOnSignUp: false,
  },
  user: {
    additionalFields: {
      termsAcceptedAt: { type: 'date', required: false, input: false },
      termsVersion: { type: 'string', required: false, input: false },
    },
    changeEmail: {
      // Email changes use the email-OTP plugin below, not verification links.
      enabled: false,
    },
    deleteUser: {
      enabled: true,
      beforeDelete: async (user) => {
        // A deleted account's join links stop working (createdById becomes null
        // and authorizes nothing); disable them so admins see that too.
        await reassignOrDeleteOrgs(user.id);
        await revokeJoinLinksBeyondRole(prisma, null, user.id, null);
        // Copies of the account's comments in Trash are removed by the
        // page_trash_erase_user trigger, in the user delete's own transaction.
      },
    },
  },
  plugins: [
    admin({
      adminRoles: ['admin'],
      defaultRole: 'user',
      impersonationSessionDuration: 60 * 60,
    }),
    emailOTP({
      // Customer sign-in doubles as passwordless sign-up. The API gateway adds
      // an admin-origin guard so this can never create an admin account.
      // Always queue sign-in codes, so the HTTP acknowledgement is independent
      // of eligibility and provider latency/failure. The worker drops unknown
      // recipients on closed instances; the creation hook checks verified OTPs.
      disableSignUp: false,
      overrideDefaultEmailVerification: true,
      changeEmail: {
        enabled: true,
        verifyCurrentEmail: true,
      },
      expiresIn: AUTH_OTP_EXPIRY_SECONDS,
      allowedAttempts: 3,
      rateLimit: { window: 5 * 60, max: 3 },
      resendStrategy: 'rotate',
      storeOTP: 'hashed',
      async sendVerificationOTP({ email, otp, type }, context) {
        await trackRequiredAuthEmail(context, async () => {
          const queued = await deliverAuthOtpEmail({ email, otp, type }, context, async (auth) => {
            const message = renderVerificationCodeEmail({ code: otp, purpose: type, language: resolveRequestLocale(context?.headers) });
            if (type === 'sign-in') {
              // Only Redis acknowledgement is required here, equally for all
              // addresses. Worker/provider failures are retried out of band.
              await withTimeout(
                createJob(QueueNames.EMAIL, {
                  name: 'send-email',
                  data: {
                    to: email,
                    ...(await message),
                    auth: { ...auth, existingUserOnly: env.DISABLE_SIGNUP },
                  },
                }),
                15_000,
              );
            } else {
              // Authenticated verification/email-change operations retain their
              // provider-confirmed delivery contract.
              await deliverRequiredAuthEmail(email, message, auth);
            }
          });
          if (!queued) {
            log.info('superseded auth email skipped before enqueue');
          }
        });
      },
    }),
    organization({
      // Workspaces are erased only through eraseProjectOrganization (analytics, search,
      // storage, usage); the plugin's own delete endpoint would skip all of it.
      disableOrganizationDeletion: true,
    }),
    ...(mcpOAuth ? mcpOAuthPlugins(mcpOAuth) : []),
    // Every organization response is filtered, so metadata rows the API has
    // not cleaned up yet never reach members with server-only fields.
    organizationMetadataResponseFilter(),
  ],
  databaseHooks: {
    user: {
      create: {
        before: async (user, context) => {
          if (context?.path === '/sign-in/email-otp') {
            // Better Auth verifies and consumes the OTP before invoking this
            // hook. Never move this check to the send-code or before-verify path.
            if (env.DISABLE_SIGNUP) {
              throw new APIError('BAD_REQUEST', { code: 'SIGNUP_CLOSED', message: 'New account registration is closed on this instance.' });
            }
            if (context.body?.acceptTerms !== true) {
              throw termsRequired();
            }
            return { data: { ...user, termsAcceptedAt: new Date(), termsVersion: TERMS_VERSION } };
          }
          // Only protected server context, captured at flow initiation, can
          // attest to consent across Google's redirect. Client additionalData
          // is untrusted. ID-token creation has no redirect state of its own.
          const googleCallback = context?.path?.startsWith('/callback/') && context.params?.id === 'google';
          const googleToken = context?.path === '/sign-in/social' && context.body?.provider === 'google';
          if (googleCallback || googleToken) {
            const version = googleCallback
              ? (await getOAuthState())?.serverContext?.termsVersion
              : context?.body?.additionalData?.acceptTerms === true
                ? TERMS_VERSION
                : undefined;
            if (typeof version !== 'string' || !version) throw termsRequired();
            return { data: { ...user, termsAcceptedAt: new Date(), termsVersion: version } };
          }
          // Exempt: operator-created accounts (/admin/create-user), requestless
          // demo seeding, and synthetic fixtures have no end-user consent event.
          // Invitations/join links and MCP use the OTP/Google paths above.
          return { data: user };
        },
        after: (user, context) => provisionWorkspace(user, resolveRequestLocale(context?.headers), context?.headers ?? undefined),
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
        after: async (session, context) => {
          try {
            // Support access is an explicit admin workflow, not a customer
            // sign-in. It has its own audit event and must not trigger a false
            // "new device" security email to the customer.
            if (session.impersonatedBy) {
              await logPlatformEvent('admin_impersonation_started', {
                userId: session.userId,
                metadata: { actorUserId: String(session.impersonatedBy) },
              });
              return;
            }
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
            await sendMail(
              user.email,
              await renderNewSignInEmail({ ipAddress: session.ipAddress ?? undefined, language: resolveRequestLocale(context?.headers) }),
            );
          } catch {
            // never block sign-in
          }
        },
      },
      delete: {
        after: async (session) => {
          if (session.impersonatedBy) {
            await logPlatformEvent('admin_impersonation_ended', {
              userId: session.userId,
              metadata: { actorUserId: String(session.impersonatedBy) },
            });
          }
        },
      },
    },
  },
});

export const auth = withRequiredAuthEmailScope(authInstance);

/** Verifies an MCP OAuth access token against this instance's own JWKS. */
export const verifyMcpAccessToken = mcpOAuth
  ? createMcpAccessTokenVerifier(mcpOAuth, () =>
      (auth.api as unknown as { getJwks: () => Promise<{ keys: Array<Record<string, unknown>> }> }).getJwks(),
    )
  : null;
