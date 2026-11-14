import { growthMsAsync, growthTestsEnabled, linearGrowthLimit } from '@nibleaf/shared/testing/growth';
import { describe, expect, it, vi } from 'vitest';
import { ImportFinalPaths } from './final-paths';

const mem = vi.hoisted(() => ({ rows: [] as Array<{ id: string; path: string; kind: 'PAGE' }> }));

vi.mock('@nibleaf/database', () => ({
  prisma: {
    page: {
      findMany: async () => mem.rows,
    },
  },
}));

describe.runIf(growthTestsEnabled)('final importer paths: growth', () => {
  it('resolves n vs 4n source aliases in linear time', async () => {
    const run = async (count: number) => {
      const finalPaths = new ImportFinalPaths();
      const routes = new Map(Array.from({ length: count }, (_, index) => [`source-${index}`, `/guides/page-${index}`]));
      const ids = finalPaths.add({ projectId: 'project', branchId: 'staging', languageId: 'en' }, routes);
      for (const source of routes.keys()) ids.documents.set(source, source);
      mem.rows = [...routes.keys()].flatMap((id) => [
        { id, path: `guides-2/${id}-2`, kind: 'PAGE' as const },
        { id: `existing-${id}`, path: id, kind: 'PAGE' as const },
      ]);
      await finalPaths.resolve();
      return routes;
    };
    const [n, fourN] = await growthMsAsync(run, 2000, 8000, { minMs: 50, budgetMs: 10_000 });
    console.info(`final paths n=${n.toFixed(2)}ms, 4n=${fourN.toFixed(2)}ms, ratio=${(fourN / n).toFixed(2)}`);
    expect(fourN).toBeLessThanOrEqual(linearGrowthLimit(n));
  }, 60_000);
});
