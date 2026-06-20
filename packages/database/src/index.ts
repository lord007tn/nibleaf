import { getDb } from './client';
import { keys } from './keys';

export * from './generated/client';

// Persist the Prisma client across hot reloads in development.
const globalForPrisma = globalThis as unknown as {
  prisma: ReturnType<typeof getDb> | undefined;
};

export const prisma = globalForPrisma.prisma ?? getDb({ connectionString: keys().POSTGRES_URL });

if (process.env.NODE_ENV !== 'production') {
  globalForPrisma.prisma = prisma;
}
