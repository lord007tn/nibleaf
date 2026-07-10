import { auth } from '@nibleaf/auth/server';
import { prisma } from '@nibleaf/database';
import { logger } from '@nibleaf/logger';
import { buildSnapshot } from '@nibleaf/shared/site';

const DEMO = { email: 'demo@nibleaf.test', password: 'nibleafdemo123', name: 'Ada Lovelace' };

async function seed() {
  // Guard against clobbering a real environment with demo data.
  if (process.env.NODE_ENV === 'production' && !process.env.ALLOW_SEED) {
    throw new Error('Refusing to seed in production. Set ALLOW_SEED=1 to override.');
  }

  // Sign up the demo user via better-auth (hashes the password + provisions a
  // workspace and starter docs project through the create hook). Idempotent.
  const existing = await prisma.user.findUnique({ where: { email: DEMO.email }, select: { id: true } });
  if (!existing) {
    await auth.api.signUpEmail({ body: DEMO });
  }

  const user = await prisma.user.findUnique({ where: { email: DEMO.email } });
  if (!user) {
    throw new Error('Demo user was not created');
  }
  const member = await prisma.member.findFirst({ where: { userId: user.id }, orderBy: { createdAt: 'asc' } });
  if (!member) {
    throw new Error('Demo workspace was not provisioned');
  }
  const project = await prisma.project.findFirst({
    where: { organizationId: member.organizationId },
    orderBy: { createdAt: 'asc' },
    include: {
      languages: { orderBy: { position: 'asc' } },
      branches: { orderBy: [{ isDefault: 'desc' }, { createdAt: 'asc' }] },
    },
  });
  if (!project) {
    throw new Error('Demo project was not provisioned');
  }

  // Publish version 1 so the live site is viewable immediately after seeding.
  const already = await prisma.deployment.findFirst({ where: { projectId: project.id, status: 'READY' } });
  if (!already) {
    const pages = await prisma.page.findMany({
      where: { projectId: project.id },
      orderBy: { position: 'asc' },
      include: { language: { select: { code: true } } },
    });
    const pageRows = pages.map(({ language, updatedAt, ...page }) => ({ ...page, languageCode: language.code, updatedAt: updatedAt.toISOString() }));
    const snapshot = buildSnapshot(project, pageRows, new Date().toISOString());
    await prisma.deployment.create({
      data: {
        projectId: project.id,
        version: 1,
        status: 'READY',
        snapshot: snapshot as unknown as object,
        pagesCount: pages.filter((p) => p.kind === 'PAGE').length,
        commitMessage: 'Initial publish',
        createdById: user.id,
        completedAt: new Date(),
      },
    });
  }

  logger.info('✔ Seed complete');
  logger.info(`  workspace : ${member.organizationId}`);
  logger.info(`  project   : ${project.name} (${project.id})`);
  logger.info(`  live site : /sites/${project.id}`);
  logger.info(`  sign in   : ${DEMO.email} / ${DEMO.password}`);
}

seed()
  .then(() => process.exit(0))
  .catch((error) => {
    // Log the actual message/stack — a bare Error serializes to `{}` under pino
    // (its fields are non-enumerable), which hid why the seed failed.
    logger.error({ err: error instanceof Error ? { message: error.message, stack: error.stack } : error }, 'seed failed');
    process.exit(1);
  });
