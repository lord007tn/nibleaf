import { getDb } from '../src/client';

const connectionString = process.env.POSTGRES_URL;
if (!connectionString) throw new Error('POSTGRES_URL is required for the Prisma runtime smoke test');

const db = getDb({ connectionString });
try {
  const rows = await db.$queryRaw<Array<{ result: number }>>`SELECT 1::int AS result`;
  if (rows.length !== 1 || rows[0]?.result !== 1) throw new Error(`Unexpected Prisma runtime result: ${JSON.stringify(rows)}`);
  console.log('Prisma runtime database query passed.');
} finally {
  await db.$disconnect();
}
