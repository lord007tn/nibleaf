import { type Prisma, PrismaClient } from '@nibleaf/database';
import { expect, it } from 'vitest';

it('emits two SQL statements for the project and its starter baseline relation', async () => {
  // Exercise the real generated client/compiler without relationJoins. Only
  // the driver is a recording fixture; no PostgreSQL connection is opened.
  // This projection isolates the baseline cost, excluding other draft relations.
  const statements: string[] = [];
  const projectId = 'fictional-project-544';
  const adapter: NonNullable<Prisma.PrismaClientOptions['adapter']> = {
    adapterName: 'starter-baseline-sql-recording',
    provider: 'postgres',
    connect: async () => ({
      adapterName: 'starter-baseline-sql-recording',
      provider: 'postgres',
      queryRaw: async ({ sql }) => {
        statements.push(sql);
        // Prisma's driver contract uses column type 7 for PostgreSQL text.
        if (sql.includes('"project_starter_baseline"')) {
          return { columnNames: ['projectId', 'bodyHash'], columnTypes: [7, 7], rows: [[projectId, 'fictional-body-hash']] };
        }
        if (sql.includes('"project"')) return { columnNames: ['id'], columnTypes: [7], rows: [[projectId]] };
        throw new Error(`Unexpected statement in SELECT-only fixture: ${sql}`);
      },
      executeRaw: async () => {
        throw new Error('Unexpected write in SELECT-only fixture');
      },
      executeScript: async () => {
        throw new Error('Unexpected script in SELECT-only fixture');
      },
      startTransaction: async () => {
        throw new Error('Unexpected transaction in SELECT-only fixture');
      },
      dispose: async () => undefined,
    }),
  };
  const client = new PrismaClient({ adapter });
  try {
    const project = await client.project.findUnique({
      where: { id: projectId },
      select: { id: true, starterBaselines: { select: { bodyHash: true } } },
    });
    expect(project).toEqual({ id: projectId, starterBaselines: [{ bodyHash: 'fictional-body-hash' }] });
    expect(statements).toHaveLength(2);
    expect(statements[0]).toContain('"project"');
    expect(statements[1]).toContain('"project_starter_baseline"');
  } finally {
    await client.$disconnect();
  }
});
