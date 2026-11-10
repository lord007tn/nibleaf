import { createHmac, randomUUID } from 'node:crypto';
import { createMcpAccessTokenVerifier, resolveMcpOAuthConfig } from '@nibleaf/auth/mcp-oauth';
import { prisma } from '@nibleaf/database';
import { hashApiKeySecret } from '@nibleaf/shared/crypto';
import { MCP_OAUTH_GRANT_CLAIM, MCP_OAUTH_PROJECT_CLAIM } from '@nibleaf/shared/mcp';
import { Hono } from 'hono';
import { exportJWK, generateKeyPair, SignJWT } from 'jose';
import { afterAll, describe, expect, it, vi } from 'vitest';
import type { HonoEnv } from '../lib/hono/context';
import { applyMerge, canonical, planMerge, restoreMerge } from './org-merge';

const oauth = vi.hoisted(() => ({
  config: { origin: 'https://app.nibleaf.test', issuer: 'https://app.nibleaf.test/api/auth', resource: 'https://app.nibleaf.test/api/mcp' },
  verify: null as ReturnType<typeof createMcpAccessTokenVerifier> | null,
}));
// Local signing keys replace provider discovery only. JWT validation, grant
// lookup, account checks and production request authorization all run for real.
vi.mock('@nibleaf/auth/server', () => ({
  mcpOAuth: oauth.config,
  verifyMcpAccessToken: (...args: Parameters<ReturnType<typeof createMcpAccessTokenVerifier>>) => {
    if (!oauth.verify) throw new Error('Verifier not configured');
    return oauth.verify(...args);
  },
  auth: { $context: Promise.resolve({}) },
}));
vi.mock('@/env', () => ({ env: { MCP_ENABLED: true } }));

describe.skipIf(process.env.ORG_MERGE_INTEGRATION !== '1')('merge keeps website credentials valid', () => {
  const run = `merge-creds-${randomUUID().slice(0, 8)}`;
  const ids = [`${run}-a`, `${run}-b`];
  afterAll(async () => {
    if (process.env.ORG_MERGE_INTEGRATION !== '1') return;
    await prisma.orgMergeJournal.deleteMany({ where: { groupKey: run } });
    await prisma.project.deleteMany({ where: { organizationId: { in: ids } } });
    await prisma.organization.deleteMany({ where: { id: { in: ids } } });
    await prisma.user.deleteMany({ where: { id: run } });
    await prisma.oauthClient.deleteMany({ where: { clientId: run } });
    await prisma.$disconnect();
  });
  it('authenticates the same API key, signed OAuth token and Git signature before and after merge, then restores secret-free journal references', async () => {
    await prisma.user.create({ data: { id: run, name: 'Credential Owner', email: `${run}@nibleaf.test`, emailVerified: true } });
    for (const id of ids) {
      await prisma.organization.create({ data: { id, name: 'My workspace', slug: id } });
      await prisma.member.create({ data: { organizationId: id, userId: run, role: 'owner', orgRole: 'owner' } });
      await prisma.project.create({
        data: { id, organizationId: id, name: id, slug: id, config: { ai: { apiKey: 'fictional-project-config-key' } } },
      });
    }
    const source = ids[1] ?? '';
    const webhookSecret = 'fictional-webhook-secret';
    await prisma.projectGitSettings.create({ data: { projectId: source, settings: { provider: 'github', repo: 'synthetic/repo' } } });
    await prisma.projectLegacySettings.create({ data: { projectId: source, metadata: { integrations: { endpoint: 'fictional' } } } });
    await prisma.organization.update({
      where: { id: source },
      data: {
        metadata: JSON.stringify({ git: { provider: 'github', repo: 'synthetic/repo', webhookSecret }, integrations: { endpoint: 'fictional' } }),
      },
    });
    await prisma.organizationGitWebhookSecret.create({ data: { organizationId: source, secret: webhookSecret } });
    const connection = await prisma.gitConnection.create({
      data: {
        projectId: source,
        repository: 'synthetic/repo',
        headBranch: 'nibleaf',
        createdById: run,
        credentialEncrypted: 'fictional-envelope',
        webhookSecretEncrypted: 'fictional-webhook-envelope',
      },
    });
    const apiSecret = `plm_live_${'A'.repeat(32)}`;
    await prisma.apiKey.create({
      data: {
        projectId: source,
        name: 'Synthetic',
        createdById: run,
        hashedSecret: hashApiKeySecret(apiSecret),
        lastFour: 'AAAA',
        scopes: ['mcp:connect', 'mcp:read'],
        expiresAt: new Date(Date.now() + 3_600_000),
      },
    });
    await prisma.oauthClient.create({
      data: { id: run, clientId: run, name: 'Synthetic client', redirectUris: [], scopes: ['mcp:connect', 'mcp:read'] },
    });
    const grant = await prisma.mcpOAuthGrant.create({
      data: {
        projectId: source,
        userId: run,
        clientId: run,
        clientName: 'Synthetic',
        preset: 'read',
        scopes: ['mcp:connect', 'mcp:read'],
        activatedAt: new Date(),
      },
    });
    const config = resolveMcpOAuthConfig({ MCP_ENABLED: true, BETTER_AUTH_URL: oauth.config.origin });
    if (!config) throw new Error('Expected HTTPS OAuth config');
    const pair = await generateKeyPair('ES256');
    const publicJwk = await exportJWK(pair.publicKey);
    oauth.verify = createMcpAccessTokenVerifier(config, async () => ({ keys: [{ ...publicJwk, kid: run, alg: 'ES256' }] }));
    const token = await new SignJWT({ azp: run, scope: 'mcp:connect mcp:read', [MCP_OAUTH_GRANT_CLAIM]: grant.id, [MCP_OAUTH_PROJECT_CLAIM]: source })
      .setProtectedHeader({ alg: 'ES256', kid: run, typ: 'at+jwt' })
      .setSubject(run)
      .setIssuer(config.issuer)
      .setAudience(config.resource)
      .setIssuedAt()
      .setExpirationTime('1h')
      .sign(pair.privateKey);
    const { authenticateMcpRequest } = await import('../mcp/auth');
    const { getGitWebhookSecret } = await import('../actions/git-webhook-secret');
    const { verifyGitHubSignature } = await import('../actions/git-webhook');
    const app = new Hono<HonoEnv>();
    app.post('/api/mcp', async (ctx) => {
      const principal = await authenticateMcpRequest(ctx);
      return principal instanceof Response
        ? principal
        : ctx.json({ projectId: principal.project.id, actor: principal.actor, kind: principal.credential.kind });
    });
    const body = '{"ref":"refs/heads/main"}';
    const signature = `sha256=${createHmac('sha256', webhookSecret).update(body).digest('hex')}`;
    const authenticate = async (secret: string) => {
      const response = await app.request('https://app.nibleaf.test/api/mcp', { method: 'POST', headers: { authorization: `Bearer ${secret}` } });
      expect(response.status).toBe(200);
      expect(await response.json()).toMatchObject({ projectId: source, actor: { userId: run, role: 'owner' } });
    };
    await authenticate(apiSecret);
    await authenticate(token);
    expect(verifyGitHubSignature(body, signature, (await getGitWebhookSecret(source)) ?? '')).toBe(true);
    const plan = await planMerge();
    plan.groups = plan.groups.filter((group) => group.ownerId === run);
    expect((await applyMerge(plan, { quota: { merge: async () => undefined } }))[0]?.status).toBe('applied');
    await authenticate(apiSecret);
    await authenticate(token);
    expect(verifyGitHubSignature(body, signature, (await getGitWebhookSecret(source)) ?? '')).toBe(true);
    expect(await prisma.gitConnection.findUniqueOrThrow({ where: { id: connection.id } })).toEqual(connection);
    const journal = await prisma.orgMergeJournal.findMany({ where: { runId: plan.runId } });
    expect(canonical(journal)).not.toContain(webhookSecret);
    expect(canonical(journal)).not.toContain('fictional-envelope');
    expect(canonical(journal)).not.toContain('fictional-project-config-key');
    expect(await restoreMerge(plan.runId, { offline: true })).toEqual([{ groupKey: run, status: 'restored' }]);
    expect((await prisma.organizationGitWebhookSecret.findUniqueOrThrow({ where: { organizationId: source } })).secret).toBe(webhookSecret);
    await authenticate(apiSecret);
    await authenticate(token);
  }, 120_000);
});
