import { migrateClickHouseSchema } from '../src/initialization';

try {
  if (!(await migrateClickHouseSchema())) {
    throw new Error('ClickHouse migration lock held by another process; retry this command.');
  }
  process.stdout.write('[nibleaf] ClickHouse analytics migrations complete.\n');
} finally {
  const { prisma } = await import('@nibleaf/database');
  await prisma.$disconnect();
}
