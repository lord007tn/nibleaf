import { getDb, type PrismaClient } from './client';
import type { Prisma } from './generated/client';
import { keys } from './keys';

export * from './generated/client';

// Persist the Prisma client across hot reloads in development.
const globalForPrisma = globalThis as unknown as {
  prisma: PrismaClient | undefined;
};

export const prisma = globalForPrisma.prisma ?? getDb({ connectionString: keys().POSTGRES_URL });

export const markUsageStorageWritten = async (organizationId: string) =>
  prisma.usageStorageMarker.upsert({
    where: { organizationId },
    create: { organizationId },
    update: { lastWrittenAt: new Date() },
    select: { organizationId: true },
  });

/** Usage owns default plan provisioning. Product creation paths call this in
 * the same transaction as the organization; add-ons and payment adapters never
 * write plan state. The free plan has no invented quotas or payment metadata. */
export const assignDefaultUsagePlan = async (tx: Prisma.TransactionClient, organizationId: string) => {
  const plan = await tx.usagePlan.upsert({
    where: { key: 'free' },
    create: { key: 'free', name: 'Free', version: 1, active: true },
    update: {},
    select: { id: true },
  });
  return tx.organizationUsagePlan.upsert({
    where: { organizationId },
    create: { organizationId, planId: plan.id, status: 'active' },
    update: {},
    select: { organizationId: true, planId: true },
  });
};

if (keys().NODE_ENV !== 'production') {
  globalForPrisma.prisma = prisma;
}
