import { strFromU8, unzipSync } from 'fflate';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({ getCurrentSnapshot: vi.fn() }));

vi.mock('@nibleaf/database', () => ({ prisma: {} }));
vi.mock('@/errors', () => ({ notFound: vi.fn() }));
vi.mock('./deployments', () => ({ getCurrentSnapshot: mocks.getCurrentSnapshot }));

import { exportProjectThemeRepository } from './export';

beforeEach(() => {
  mocks.getCurrentSnapshot.mockResolvedValue({
    project: {
      id: 'project_123',
      name: 'Acme Docs',
      slug: 'acme-docs',
      description: null,
      icon: null,
      config: { theme: { preset: 'harbor' } },
      languages: [{ code: 'en', label: 'English', direction: 'LTR', isDefault: true, config: null }],
      versions: [{ id: 'main', name: 'Main', slug: 'main', isDefault: true }],
    },
    pages: [
      {
        id: 'welcome',
        parentId: null,
        versionId: 'main',
        languageCode: 'en',
        kind: 'PAGE',
        title: 'Welcome',
        slug: 'welcome',
        path: '/welcome',
        icon: null,
        description: 'Start here.',
        content: '## Hello\n\nRunnable fixture content.',
        config: null,
        translationKey: null,
        position: 0,
        hidden: false,
        updatedAt: '2026-08-23T00:00:00.000Z',
      },
    ],
    generatedAt: '2026-08-23T00:00:00.000Z',
  });
});

describe('theme repository export', () => {
  it('returns a runnable source archive instead of a JSON-only theme', async () => {
    const result = await exportProjectThemeRepository('project_123');
    const archive = unzipSync(result.data);

    expect(result.fileName).toBe('acme-docs-harbor-theme.zip');
    expect(Object.keys(archive)).toEqual(
      expect.arrayContaining([
        'nibleaf.theme.json',
        '.nibleaf/snapshot.json',
        'src/nibleaf/runtime.ts',
        'src/adapters/content.ts',
        'src/theme/HarborTheme.tsx',
        'src/theme/theme.css',
        'content/main/en/welcome.mdx',
        'package.json',
        'README.md',
      ]),
    );
    expect(strFromU8(archive['package.json'] ?? new Uint8Array())).not.toContain('workspace:');
    expect(strFromU8(archive['content/main/en/welcome.mdx'] ?? new Uint8Array())).toContain('Runnable fixture content.');
  });
});
