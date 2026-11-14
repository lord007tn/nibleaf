import { growthMsAsync, growthTestsEnabled, linearGrowthLimit } from '@nibleaf/shared/testing/growth';
import { describe, expect, it, vi } from 'vitest';
import { ImportFinalPaths } from './final-paths';

vi.mock('@nibleaf/database', () => ({
  prisma: {
    page: {
      findMany: async ({ where }: { where: { id: { in: string[] } } }) => where.id.in.map((id) => ({ id, path: `guides-2/${id}-2` })),
    },
  },
}));

describe.runIf(growthTestsEnabled)('final importer paths: growth', () => {
  it('resolves n vs 4n source aliases in linear time', async () => {
    const run = async (count: number) => {
      const finalPaths = new ImportFinalPaths();
      const routes = new Map(Array.from({ length: count }, (_, index) => [`source-${index}`, `/guides/page-${index}`]));
      const ids = finalPaths.add({ projectId: 'project', branchId: 'staging', languageId: 'en' }, routes);
      for (const source of routes.keys()) ids.set(source, source);
      await finalPaths.resolve();
      return routes;
    };
    const [n, fourN] = await growthMsAsync(run, 2000, 8000, { minMs: 50, budgetMs: 10_000 });
    console.info(`final paths n=${n.toFixed(2)}ms, 4n=${fourN.toFixed(2)}ms, ratio=${(fourN / n).toFixed(2)}`);
    expect(fourN).toBeLessThanOrEqual(linearGrowthLimit(n));
  }, 60_000);
});
