import { timingSafeEqual } from 'node:crypto';
import { type GitConnection, prisma } from '@nibleaf/database';
import { gitWebhookParams } from '@nibleaf/validators';
import { type Context, Hono } from 'hono';
import {
  getConnectionWebhookSecret,
  getReadyGitPreview,
  processGitOperation,
  queueGitOperation,
  recordWebhookDelivery,
} from '@/actions/git/workflow';
import { extractPushBranch, getStoredGitConfig, runGitWebhookSync, verifyGitHubSignature, verifyGitLabToken } from '@/actions/git-webhook';
import { env } from '@/env';
import { AppError, badRequest, notFound } from '@/errors';
import type { HonoEnv } from '@/lib/hono/context';
import { validator } from '@/lib/hono/validate';
import gitRoutes from './routes';

const unauthorized = (message: string) => new AppError({ code: 'http:unauthorized', message });
const safeEqual = (left: string, right: string): boolean => {
  const a = Buffer.from(left);
  const b = Buffer.from(right);
  return a.length === b.length && timingSafeEqual(a, b);
};

type GitHubWebhookPayload = {
  ref?: string;
  repository?: { full_name?: string };
  action?: string;
  pull_request?: { number?: number; state?: string; head?: { ref?: string; sha?: string }; base?: { ref?: string } };
  number?: number;
};

const parsePayload = (rawBody: string): GitHubWebhookPayload => {
  try {
    return JSON.parse(rawBody) as GitHubWebhookPayload;
  } catch {
    throw badRequest('Webhook body must be JSON (content type application/json).');
  }
};

const handleTwoWayGitHubWebhook = async (ctx: Context<HonoEnv>, connection: GitConnection, rawBody: string) => {
  const secret = getConnectionWebhookSecret(connection);
  if (!secret || !verifyGitHubSignature(rawBody, ctx.req.header('x-hub-signature-256'), secret)) {
    throw unauthorized('Invalid webhook signature.');
  }
  const event = ctx.req.header('x-github-event') ?? '';
  if (event === 'ping') return ctx.json({ data: { ok: true, event: 'ping' } }, 200);
  const deliveryId = ctx.req.header('x-github-delivery');
  if (!deliveryId || !/^[A-Za-z0-9-]{8,100}$/.test(deliveryId)) throw badRequest('Missing or invalid X-GitHub-Delivery id.');
  const payload = parsePayload(rawBody);
  if (payload.repository?.full_name?.toLowerCase() !== connection.repository.toLowerCase()) {
    throw unauthorized('Webhook repository does not match the configured connection.');
  }
  const delivery = await recordWebhookDelivery({ connectionId: connection.id, deliveryId, event, rawBody });

  let sourceRef: string | undefined;
  let pullRequestNumber: number | undefined;
  let sourceSha: string | undefined;
  if (event === 'push') {
    sourceRef = extractPushBranch(payload) ?? undefined;
    if (!sourceRef || ![connection.baseBranch, connection.headBranch].includes(sourceRef)) {
      await prisma.gitWebhookDelivery.update({ where: { id: delivery.id }, data: { status: 'IGNORED', processedAt: new Date() } });
      return ctx.json({ data: { ok: true, ignored: 'branch', branch: sourceRef ?? null } }, 200);
    }
  } else if (event === 'pull_request') {
    const action = payload.action ?? '';
    pullRequestNumber = payload.number ?? payload.pull_request?.number;
    if (action === 'closed' && pullRequestNumber) {
      const pull = await prisma.gitPullRequest.findUnique({
        where: { connectionId_number: { connectionId: connection.id, number: pullRequestNumber } },
      });
      if (pull) {
        await prisma.$transaction([
          prisma.gitPullRequest.update({ where: { id: pull.id }, data: { state: 'closed', draft: false, lastSyncedAt: new Date() } }),
          prisma.gitPreview.updateMany({ where: { pullRequestId: pull.id, status: 'READY' }, data: { status: 'SUPERSEDED' } }),
        ]);
      }
      await prisma.gitWebhookDelivery.update({ where: { id: delivery.id }, data: { status: 'PROCESSED', processedAt: new Date() } });
      return ctx.json({ data: { ok: true, pullRequest: pullRequestNumber, state: 'closed' } }, 200);
    }
    if (!['opened', 'reopened', 'synchronize', 'ready_for_review', 'converted_to_draft'].includes(action)) {
      await prisma.gitWebhookDelivery.update({ where: { id: delivery.id }, data: { status: 'IGNORED', processedAt: new Date() } });
      return ctx.json({ data: { ok: true, ignored: 'action', action } }, 200);
    }
    if (payload.pull_request?.base?.ref !== connection.baseBranch) {
      await prisma.gitWebhookDelivery.update({ where: { id: delivery.id }, data: { status: 'IGNORED', processedAt: new Date() } });
      return ctx.json({ data: { ok: true, ignored: 'base' } }, 200);
    }
    sourceRef = payload.pull_request?.head?.ref;
    sourceSha = payload.pull_request?.head?.sha;
    if (!(sourceRef && pullRequestNumber)) throw badRequest('Pull request webhook is missing branch or number.');
  } else {
    await prisma.gitWebhookDelivery.update({ where: { id: delivery.id }, data: { status: 'IGNORED', processedAt: new Date() } });
    return ctx.json({ data: { ok: true, ignored: 'event', event } }, 200);
  }

  const operation = await queueGitOperation(connection.projectId, null, {
    idempotencyKey: `webhook-${deliveryId}`,
    kind: 'PULL',
    sourceRef,
    sourceSha,
    pullRequestNumber,
  });
  await prisma.gitWebhookDelivery.update({ where: { id: delivery.id }, data: { status: 'QUEUED', attempts: { increment: 1 } } });
  return ctx.json({ data: { accepted: true, operationId: operation.id, duplicate: delivery.duplicate } }, 202);
};

const app = new Hono<HonoEnv>()
  .post('/jobs/:operationId', ...gitRoutes.job, async (ctx) => {
    const provided = ctx.req.header('x-nibleaf-git-worker') ?? '';
    if (!env.GIT_WORKER_SECRET || !safeEqual(provided, env.GIT_WORKER_SECRET)) throw unauthorized('Invalid Git worker credential.');
    await processGitOperation(ctx.req.param('operationId'));
    return ctx.json({ data: { ok: true } }, 200);
  })
  .get('/previews/:token', ...gitRoutes.preview, async (ctx) => {
    const preview = await getReadyGitPreview(ctx.req.param('token'));
    ctx.header('Cache-Control', 'private, no-store');
    ctx.header('X-Robots-Tag', 'noindex, nofollow');
    return ctx.json({ data: preview }, 200);
  })
  .post('/webhook/:projectId', ...gitRoutes.webhook, validator('param', gitWebhookParams), async (ctx) => {
    const { projectId } = ctx.req.valid('param');
    const rawBody = await ctx.req.text();
    const twoWay = await prisma.gitConnection.findUnique({ where: { projectId } });
    if (twoWay) return handleTwoWayGitHubWebhook(ctx, twoWay, rawBody);

    // Backward-compatible one-way webhook path for metadata.git connections.
    const project = await prisma.project.findUnique({ where: { id: projectId }, select: { organizationId: true } });
    if (!project) throw notFound('project', { projectId });
    const git = await getStoredGitConfig(project.organizationId);
    const secret = git.webhookSecret;
    if (!secret) throw unauthorized('No webhook secret is configured for this project. Generate one in Settings → Git.');
    const githubEvent = ctx.req.header('x-github-event');
    const gitlabEvent = ctx.req.header('x-gitlab-event');
    let isPush: boolean;
    if (githubEvent !== undefined || ctx.req.header('x-hub-signature-256') !== undefined) {
      if (!verifyGitHubSignature(rawBody, ctx.req.header('x-hub-signature-256'), secret)) throw unauthorized('Invalid webhook signature.');
      if (githubEvent === 'ping') return ctx.json({ data: { ok: true, event: 'ping' } }, 200);
      isPush = githubEvent === 'push';
    } else if (gitlabEvent !== undefined || ctx.req.header('x-gitlab-token') !== undefined) {
      if (!verifyGitLabToken(ctx.req.header('x-gitlab-token'), secret)) throw unauthorized('Invalid webhook token.');
      isPush = gitlabEvent === 'Push Hook';
    } else {
      throw badRequest('Unrecognized webhook provider headers.');
    }
    if (!isPush) return ctx.json({ data: { ok: true, ignored: 'event' } }, 200);
    const pushedBranch = extractPushBranch(parsePayload(rawBody));
    const configuredBranch = git.branch?.trim() || 'main';
    if (pushedBranch !== configuredBranch) return ctx.json({ data: { ok: true, ignored: 'branch', branch: pushedBranch } }, 200);
    void runGitWebhookSync(project.organizationId, projectId, configuredBranch);
    return ctx.json({ data: { accepted: true, branch: configuredBranch, legacy: true } }, 202);
  });

export default app;
