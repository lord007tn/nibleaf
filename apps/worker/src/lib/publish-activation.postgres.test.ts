import { randomUUID } from 'node:crypto';
import { prisma } from '@nibleaf/database';
import { expect, it } from 'vitest';
import { recordPublishReady } from './publish-activation';

// Explicit opt-in: CI supplies its disposable migrated PostgreSQL service.
it.skipIf(process.env.ACTIVATION_INTEGRATION !== '1')(
  'deduplicates concurrent READY retries and isolates authors/projects in PostgreSQL',
  async () => {
    const run = randomUUID();
    const userId = `activation-qa-${run}`;
    const completedAt = new Date();
    const ready = { createdById: userId, version: 2, completedAt };
    const job = {
      deploymentId: `deployment-${run}`,
      projectId: `project-${run}`,
      auto: false,
      firstPublishAttribution: { entry_point: 'organic_content', intent: 'first_publish', source: 'mintlify_introduction' },
    } as const;
    try {
      await Promise.all(Array.from({ length: 12 }, () => recordPublishReady(job, ready)));
      expect(await prisma.platformEvent.count({ where: { userId, type: 'publish_ready' } })).toBe(1);
      expect(await prisma.platformEvent.count({ where: { userId, type: 'first_manual_publish_ready' } })).toBe(1);
      const sourceCount = () => prisma.platformEvent.count({ where: { type: 'publish_ready', userId: null, createdAt: completedAt } });
      expect(await sourceCount()).toBe(1);
      await recordPublishReady({ ...job, deploymentId: `later-${run}` }, ready);
      expect(await sourceCount()).toBe(1);
      await recordPublishReady({ ...job, deploymentId: `other-${run}`, projectId: `other-${run}` }, ready);
      expect(await sourceCount()).toBe(2);
      await recordPublishReady({ ...job, deploymentId: `auto-${run}`, projectId: `auto-${run}`, auto: true }, ready);
      expect(await sourceCount()).toBe(2);
      expect(await prisma.platformEvent.count({ where: { userId, type: 'first_manual_publish_ready' } })).toBe(2);
    } finally {
      await prisma.platformEvent.deleteMany({ where: { OR: [{ userId }, { type: 'publish_ready', userId: null, createdAt: completedAt }] } });
      await prisma.$disconnect();
    }
  },
  30_000,
);
