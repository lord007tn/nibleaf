import type { Prisma } from '@nibleaf/database';
import { describe, expect, it, vi } from 'vitest';
import { updateProjectConfigSection } from './project-config';

describe('optimistic project config section writes', () => {
  it('re-reads after a CAS race and preserves the fresh sibling config', async () => {
    const first = { config: { theme: { preset: 'old' } }, updatedAt: new Date('2026-08-23T10:00:00Z') };
    const second = { config: { theme: { preset: 'fresh' }, analytics: { enabled: true } }, updatedAt: new Date('2026-08-23T10:00:01Z') };
    const findFirst = vi.fn().mockResolvedValueOnce(first).mockResolvedValueOnce(second);
    const updateManyAndReturn = vi
      .fn()
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([
        {
          id: 'project-a',
          config: { theme: { preset: 'fresh' }, analytics: { enabled: true }, search: { maxResults: 20 } },
          updatedAt: new Date('2026-08-23T10:00:02Z'),
        },
      ]);
    const tx = { project: { findFirst, updateManyAndReturn } } as unknown as Prisma.TransactionClient;

    const result = await updateProjectConfigSection(tx, 'org-a', 'project-a', 'search', () => ({ maxResults: 20 }));
    expect(result.config).toMatchObject({ theme: { preset: 'fresh' }, analytics: { enabled: true }, search: { maxResults: 20 } });
    expect(updateManyAndReturn).toHaveBeenLastCalledWith(
      expect.objectContaining({
        where: { id: 'project-a', organizationId: 'org-a', updatedAt: second.updatedAt },
        data: { config: { theme: { preset: 'fresh' }, analytics: { enabled: true }, search: { maxResults: 20 } } },
      }),
    );
  });

  it('treats a malformed legacy root as an empty record instead of throwing', async () => {
    const updateManyAndReturn = vi.fn().mockResolvedValue([{ id: 'project-a', config: { search: { maxResults: 12 } }, updatedAt: new Date() }]);
    const tx = {
      project: { findFirst: vi.fn().mockResolvedValue({ config: 'legacy-invalid-json-shape', updatedAt: new Date() }), updateManyAndReturn },
    } as unknown as Prisma.TransactionClient;
    await expect(updateProjectConfigSection(tx, 'org-a', 'project-a', 'search', () => ({ maxResults: 12 }))).resolves.toMatchObject({
      config: { search: { maxResults: 12 } },
    });
  });
});
