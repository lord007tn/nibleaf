import { randomUUID } from 'node:crypto';
import { prisma } from '@nibleaf/database';
import { expect, it, vi } from 'vitest';

vi.mock('@nibleaf/bullmq', () => ({ createJob: vi.fn(), getJob: vi.fn(), QueueNames: { PUBLISH: 'publish' } }));
vi.mock('./lib/notify', () => ({ notifyDeployment: vi.fn() }));

import { findRecoverableDeployments } from './reaper';

// Run through the shared-services nibleaf-audit-test wrapper, never the dogfood DB.
it.skipIf(process.env.ACTIVATION_INTEGRATION !== '1')(
  'executes the recovery query in PostgreSQL and excludes historical, receipted, fresh and superseded deliveries',
  async () => {
    const run = randomUUID();
    const now = new Date();
    const rollback = new Error('Rollback synthetic recovery fixtures');
    try {
      await expect(
        prisma.$transaction(
          async (tx) => {
            const ready = (name: string, minutesAgo: number) => ({
              id: `${run}-${name}`,
              projectId: `${run}-${name}`,
              version: 1,
              status: 'READY' as const,
              snapshot: {},
              completedAt: new Date(now.getTime() - minutesAgo * 60_000),
            });
            const old = ready('old', 2 * 24 * 60);
            const recent = ready('recent', 2);
            const receipted = ready('receipted', 2);
            const superseded = ready('superseded', 2);
            const rows = [old, recent, receipted, superseded];
            const projects = rows.map((row) => row.projectId);
            await tx.organization.createMany({ data: projects.map((id) => ({ id, name: 'Synthetic recovery QA' })) });
            await tx.project.createMany({ data: projects.map((id) => ({ id, organizationId: id, name: 'Synthetic recovery QA', slug: id })) });
            const newer = { ...superseded, id: `${run}-newer`, version: 2, completedAt: new Date(now.getTime() - 30_000) };
            await tx.deployment.createMany({ data: [...rows, newer] });
            await tx.platformEvent.create({ data: { id: `publish-ready:${receipted.id}`, type: 'publish_ready', projectId: receipted.projectId } });
            const ownCandidates = async () => (await findRecoverableDeployments(tx, now)).filter((row) => row.id.startsWith(run));
            expect(await ownCandidates()).toEqual([{ id: recent.id, projectId: recent.projectId }]);
            await tx.platformEvent.create({ data: { id: `publish-ready:${recent.id}`, type: 'publish_ready', projectId: recent.projectId } });
            expect(await ownCandidates()).toEqual([]);
            throw rollback;
          },
          { timeout: 30_000 },
        ),
      ).rejects.toBe(rollback);
    } finally {
      await prisma.$disconnect();
    }
  },
  40_000,
);
