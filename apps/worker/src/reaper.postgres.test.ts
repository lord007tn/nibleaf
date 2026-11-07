import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { prisma } from '@nibleaf/database';
import { expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({ notify: vi.fn() }));

vi.mock('@nibleaf/bullmq', () => ({ createJob: vi.fn(), getJob: vi.fn(), QueueNames: { PUBLISH: 'publish' } }));
vi.mock('./lib/notify', () => ({ notifyDeployment: mocks.notify }));

import { finalizeAbandonedRetries, findRecoverableDeployments } from './reaper';

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
            const fresh = ready('fresh', 0.5);
            const rows = [old, recent, receipted, superseded, fresh];
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

it.skipIf(process.env.ACTIVATION_INTEGRATION !== '1')(
  'keeps legacy FAILED rows silent and conditionally finalizes an abandoned retry with one notice in PostgreSQL',
  async () => {
    const run = randomUUID();
    const now = new Date();
    const rollback = new Error('Rollback synthetic retry fixtures');
    mocks.notify.mockClear();
    try {
      await expect(
        prisma.$transaction(
          async (tx) => {
            await tx.organization.create({ data: { id: run, name: 'Synthetic retry QA' } });
            await tx.project.create({ data: { id: run, organizationId: run, name: 'Synthetic retry QA', slug: run } });
            const legacyId = `${run}-legacy`;
            const retryId = `${run}-retry`;
            const freshId = `${run}-fresh`;
            await tx.deployment.createMany({
              data: [
                { id: legacyId, projectId: run, version: 1, status: 'FAILED', createdAt: new Date(now.getTime() - 2 * 86_400_000) },
                {
                  id: retryId,
                  projectId: run,
                  version: 2,
                  status: 'FAILED',
                  createdAt: new Date(now.getTime() - 20 * 60_000),
                  error: 'Synthetic failure',
                },
                { id: freshId, projectId: run, version: 3, status: 'FAILED', createdAt: new Date(now.getTime() - 5 * 60_000) },
              ],
            });
            // Both readers may see the same null completion before either update.
            // The real conditional update must allow only one of them to announce.
            await Promise.all([finalizeAbandonedRetries(tx, 15, now), finalizeAbandonedRetries(tx, 15, now)]);
            await finalizeAbandonedRetries(tx, 15, now);
            expect(await tx.deployment.findUnique({ where: { id: legacyId }, select: { completedAt: true } })).toEqual({ completedAt: null });
            expect(await tx.deployment.findUnique({ where: { id: freshId }, select: { completedAt: true } })).toEqual({ completedAt: null });
            expect(await tx.deployment.findUnique({ where: { id: retryId }, select: { completedAt: true } })).toEqual({ completedAt: now });
            const ownNotices = mocks.notify.mock.calls.filter(([notice]) => notice.projectId === run);
            expect(ownNotices).toEqual([[expect.objectContaining({ deploymentId: retryId, version: 2, outcome: 'failed' })]]);
            const migration = readFileSync(
              new URL('../../../packages/database/prisma/migrations/20261107110000_publish_delivery_backfill/migration.sql', import.meta.url),
              'utf8',
            );
            for (const statement of migration.split(';').filter((part) => part.trim())) await tx.$executeRawUnsafe(statement);
            const legacy = await tx.deployment.findUniqueOrThrow({ where: { id: legacyId } });
            expect(legacy.completedAt).toEqual(legacy.createdAt);
            expect(await tx.deployment.findUnique({ where: { id: retryId }, select: { completedAt: true } })).toEqual({ completedAt: now });
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
