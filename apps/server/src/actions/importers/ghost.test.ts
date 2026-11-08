import { beforeEach, expect, it, vi } from 'vitest';

vi.mock('../projects', () => ({ assertProjectInOrg: vi.fn(async () => ({ id: 'project' })) }));
vi.mock('@nibleaf/database', () => ({ prisma: { branch: { deleteMany: vi.fn(async () => ({ count: 1 })) } } }));
vi.mock('../branches', () => ({
  captureImportDraft: vi.fn(async () => 'original-draft'),
  createImportReplacementBranch: vi.fn(async () => ({ id: 'isolated-ghost' })),
  promoteImportReplacementBranch: vi.fn(),
}));
vi.mock('../languages', () => ({ listLanguages: vi.fn(async () => [{ id: 'en', code: 'en', isDefault: true }]) }));
vi.mock('../assets', () => ({ findImportedAsset: vi.fn(async () => ({ url: '/stored.png' })), storeAsset: vi.fn() }));
vi.mock('./persistence', () => ({
  removeImportPlaceholders: vi.fn(async () => 0),
  ensureGroupPage: vi.fn(async () => 'blog'),
  upsertLeafPage: vi.fn(async () => 'imported'),
}));

import { prisma } from '@nibleaf/database';
import { promoteImportReplacementBranch } from '../branches';
import { ghostImporter } from './ghost';
import { upsertLeafPage } from './persistence';

beforeEach(() => vi.clearAllMocks());

it('imports a public Ghost post through conversion, image reuse, and persistence', async () => {
  const result = await ghostImporter.run({
    organizationId: 'org',
    projectId: 'project',
    input: {
      db: [
        {
          meta: { version: '5.82.0' },
          data: {
            posts: [
              {
                id: 'post',
                title: 'Welcome',
                slug: 'welcome',
                status: 'published',
                html: '<p>Hello</p><img src="https://images.example/welcome.png">',
              },
            ],
          },
        },
      ],
    },
  });
  expect(result).toMatchObject({ imported: 1, assetsSkipped: 0 });
  expect(promoteImportReplacementBranch).toHaveBeenCalledWith('project', 'isolated-ghost', undefined, 'original-draft', true);
  expect(upsertLeafPage).toHaveBeenCalledWith(
    { projectId: 'project', branchId: 'isolated-ghost', languageId: 'en' },
    expect.objectContaining({ title: 'Welcome', content: expect.stringContaining('/stored.png') }),
  );
});

it('discards staged Ghost pages after a conversion/persistence failure without promoting them', async () => {
  vi.mocked(upsertLeafPage).mockRejectedValueOnce(new Error('write failed'));
  await expect(
    ghostImporter.run({
      organizationId: 'org',
      projectId: 'project',
      input: { posts: [{ id: 'one', title: 'One', slug: 'one', html: '<p>One</p>' }] },
    }),
  ).rejects.toThrow('write failed');
  expect(promoteImportReplacementBranch).not.toHaveBeenCalled();
  expect(prisma.branch.deleteMany).toHaveBeenCalledWith({ where: { id: 'isolated-ghost', projectId: 'project', isDefault: false } });
});
