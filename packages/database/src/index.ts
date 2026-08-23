import { getDb, type PrismaClient } from './client';
import { keys } from './keys';

export * from './generated/client';

// Persist the Prisma client across hot reloads in development.
const globalForPrisma = globalThis as unknown as {
  prisma: PrismaClient | undefined;
};

export const prisma = globalForPrisma.prisma ?? getDb({ connectionString: keys().POSTGRES_URL });

if (keys().NODE_ENV !== 'production') {
  globalForPrisma.prisma = prisma;
}
