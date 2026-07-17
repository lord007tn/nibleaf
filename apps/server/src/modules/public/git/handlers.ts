import { prisma } from '@nibleaf/database';
import { gitWebhookParams } from '@nibleaf/validators';
import { Hono } from 'hono';
import { extractPushBranch, getStoredGitConfig, runGitWebhookSync, verifyGitHubSignature, verifyGitLabToken } from '@/actions/git-webhook';
import { AppError, badRequest, notFound } from '@/errors';
import type { HonoEnv } from '@/lib/hono/context';
import { validator } from '@/lib/hono/validate';
import gitRoutes from './routes';

const unauthorized = (message: string) => new AppError({ code: 'http:unauthorized', message });

/**
 * Push-to-deploy webhook — the self-hosted equivalent of Mintlify's GitHub App
 * flow. The user adds this URL + the project's webhook secret to their repo;
 * every push to the configured deployment branch re-imports the docs (and
 * auto-publishes when enabled). Inherits the public module's rate limiter.
 *
 * Provider detection is header-based so one endpoint serves both:
 *   - GitHub: `X-GitHub-Event` + `X-Hub-Signature-256` (HMAC-SHA256 of raw body)
 *   - GitLab: `X-Gitlab-Event` + `X-Gitlab-Token` (plain secret equality)
 */
const app = new Hono<HonoEnv>().post('/webhook/:projectId', ...gitRoutes.webhook, validator('param', gitWebhookParams), async (ctx) => {
  const { projectId } = ctx.req.valid('param');
  // Raw body FIRST — the GitHub signature is over the exact bytes, so any
  // JSON re-serialization would break verification.
  const rawBody = await ctx.req.text();

  const project = await prisma.project.findUnique({ where: { id: projectId }, select: { organizationId: true } });
  if (!project) {
    throw notFound('project', { projectId });
  }
  const git = await getStoredGitConfig(project.organizationId);
  const secret = git.webhookSecret;
  if (!secret) {
    // 401 (not 400): don't reveal to unauthenticated callers whether the
    // project exists but is merely unconfigured.
    throw unauthorized('No webhook secret is configured for this project. Generate one in Settings → Git.');
  }

  const githubEvent = ctx.req.header('x-github-event');
  const gitlabEvent = ctx.req.header('x-gitlab-event');

  let isPush: boolean;
  if (githubEvent !== undefined || ctx.req.header('x-hub-signature-256') !== undefined) {
    if (!verifyGitHubSignature(rawBody, ctx.req.header('x-hub-signature-256'), secret)) {
      throw unauthorized('Invalid webhook signature.');
    }
    if (githubEvent === 'ping') {
      return ctx.json({ data: { ok: true, event: 'ping' } }, 200);
    }
    isPush = githubEvent === 'push';
  } else if (gitlabEvent !== undefined || ctx.req.header('x-gitlab-token') !== undefined) {
    if (!verifyGitLabToken(ctx.req.header('x-gitlab-token'), secret)) {
      throw unauthorized('Invalid webhook token.');
    }
    isPush = gitlabEvent === 'Push Hook';
  } else {
    throw badRequest('Unrecognized webhook: expected GitHub (X-Hub-Signature-256) or GitLab (X-Gitlab-Token) push headers.');
  }

  if (!isPush) {
    return ctx.json({ data: { ok: true, ignored: 'event' } }, 200);
  }

  let payload: unknown;
  try {
    payload = JSON.parse(rawBody);
  } catch {
    throw badRequest('Webhook body must be JSON (content type application/json).');
  }
  const pushedBranch = extractPushBranch(payload);
  const configuredBranch = git.branch?.trim() || 'main';
  if (pushedBranch !== configuredBranch) {
    // Tag pushes and other branches are acknowledged but never deploy —
    // exactly like Mintlify only deploying the configured deployment branch.
    return ctx.json({ data: { ok: true, ignored: 'branch', branch: pushedBranch } }, 200);
  }

  // Respond fast: GitHub/GitLab time deliveries out in ~10s, and a clone+import
  // can take longer. Fire-and-forget — the outcome lands in the git metadata
  // (lastSyncAt/lastSyncStatus) and the server log, not in this response.
  void runGitWebhookSync(project.organizationId, projectId, configuredBranch);

  return ctx.json({ data: { accepted: true, branch: configuredBranch } }, 202);
});

export default app;
