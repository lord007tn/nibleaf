import { migrateClickHouseSchema } from '../src/initialization';

/** A worker may be applying the same migrations at boot. Wait for its lock
 * rather than failing a one-shot deploy step that runs alongside it. */
const LOCK_WAIT_MS = 10 * 60 * 1000;
const RETRY_MS = 5000;

try {
  const deadline = Date.now() + LOCK_WAIT_MS;
  let migrated = await migrateClickHouseSchema();
  while (!migrated && Date.now() < deadline) {
    process.stdout.write('[nibleaf] ClickHouse migrations are running in another process; waiting…\n');
    await new Promise((resolve) => setTimeout(resolve, RETRY_MS));
    migrated = await migrateClickHouseSchema();
  }
  if (!migrated) throw new Error('ClickHouse migration lock is still held by another process after 10 minutes; retry this command.');
  process.stdout.write('[nibleaf] ClickHouse analytics migrations complete.\n');
} finally {
  const { prisma } = await import('@nibleaf/database');
  await prisma.$disconnect();
}
