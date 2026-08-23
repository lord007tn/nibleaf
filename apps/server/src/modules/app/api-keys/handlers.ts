import { prisma } from '@nibleaf/database';
import { hashApiKeySecret } from '@nibleaf/shared/crypto';
import { newApiKeySecret } from '@nibleaf/shared/ids';
import { createApiKeyBody } from '@nibleaf/validators';
import { Hono } from 'hono';
import { z } from 'zod';
import { assertProjectInOrg } from '@/actions/projects';
import { notFound } from '@/errors';
import { getContextOrganizationIdOrThrow, type HonoEnv } from '@/lib/hono/context';
import { validator } from '@/lib/hono/validate';
import apiKeysRoutes from './routes';

const app = new Hono<HonoEnv>()
  .get('/', ...apiKeysRoutes.list, async (ctx) => {
    const projectId = z.string().parse(ctx.req.param('projectId'));
    await assertProjectInOrg(getContextOrganizationIdOrThrow(), projectId);
    const keys = await prisma.apiKey.findMany({
      where: { projectId },
      orderBy: { createdAt: 'desc' },
      select: { id: true, name: true, lastFour: true, scopes: true, createdAt: true, lastUsedAt: true, revokedAt: true },
    });
    return ctx.json({ data: keys }, 200);
  })
  .post('/', ...apiKeysRoutes.create, validator('json', createApiKeyBody), async (ctx) => {
    const projectId = z.string().parse(ctx.req.param('projectId'));
    await assertProjectInOrg(getContextOrganizationIdOrThrow(), projectId);
    const body = ctx.req.valid('json');
    const { secret } = newApiKeySecret('live');
    const key = await prisma.apiKey.create({
      data: { projectId, name: body.name, hashedSecret: hashApiKeySecret(secret), lastFour: secret.slice(-4), scopes: body.scopes },
      select: { id: true, name: true, lastFour: true, scopes: true, createdAt: true, lastUsedAt: true, revokedAt: true },
    });
    return ctx.json({ data: { ...key, secret } }, 201);
  })
  .delete('/:id', ...apiKeysRoutes.revoke, async (ctx) => {
    const projectId = z.string().parse(ctx.req.param('projectId'));
    await assertProjectInOrg(getContextOrganizationIdOrThrow(), projectId);
    const id = z.string().parse(ctx.req.param('id'));
    if (!(await prisma.apiKey.findFirst({ where: { id, projectId }, select: { id: true } }))) {
      throw notFound('api key', { id });
    }
    const key = await prisma.apiKey.update({
      where: { id },
      data: { revokedAt: new Date() },
      select: { id: true, name: true, lastFour: true, scopes: true, createdAt: true, lastUsedAt: true, revokedAt: true },
    });
    return ctx.json({ data: key }, 200);
  });

export default app;
