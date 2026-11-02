import { expect, it, vi } from 'vitest';

vi.mock('../projects', () => ({ assertProjectInOrg: vi.fn(async () => ({ id: 'project' })) }));
vi.mock('../branches', () => ({ getDefaultBranch: vi.fn(async () => ({ id: 'main' })) }));
vi.mock('../languages', () => ({ listLanguages: vi.fn(async () => [{ id: 'en', code: 'en', isDefault: true }]) }));
vi.mock('../assets', () => ({ findImportedAsset: vi.fn(async () => ({ url: '/stored.png' })), storeAsset: vi.fn() }));
vi.mock('./persistence', () => ({
  removeImportPlaceholders: vi.fn(async () => 0),
  ensureGroupPage: vi.fn(async () => 'blog'),
  upsertLeafPage: vi.fn(async () => 'imported'),
}));

import { ghostImporter } from './ghost';
import { upsertLeafPage } from './persistence';

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
  expect(upsertLeafPage).toHaveBeenCalledWith(
    { projectId: 'project', branchId: 'main', languageId: 'en' },
    expect.objectContaining({ title: 'Welcome', content: expect.stringContaining('/stored.png') }),
  );
});
