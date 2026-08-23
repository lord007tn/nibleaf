import { strFromU8, unzipSync } from 'fflate';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({ getCurrentSnapshot: vi.fn() }));
const templates = [
  ['harbor', 'HarborTheme'],
  ['manuscript', 'ManuscriptTheme'],
  ['signal', 'SignalTheme'],
] as const;

vi.mock('@nibleaf/database', () => ({ prisma: {} }));
vi.mock('@/errors', () => ({ notFound: vi.fn() }));
vi.mock('./deployments', () => ({ getCurrentSnapshot: mocks.getCurrentSnapshot }));

import { exportProjectThemeRepository } from './export';

const snapshotFor = (template: (typeof templates)[number][0]) => ({
  project: {
    id: 'project_123',
    name: 'Acme Docs',
    slug: 'acme-docs',
    description: null,
    icon: null,
    config: { theme: { preset: template } },
    languages: [{ code: 'en', label: 'English', direction: 'LTR', isDefault: true, enabled: true, config: null }],
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

beforeEach(() => {
  mocks.getCurrentSnapshot.mockResolvedValue(snapshotFor('harbor'));
});

describe('theme repository export', () => {
  it.each(templates)('returns a runnable %s source archive instead of a JSON-only theme', async (template, componentName) => {
    mocks.getCurrentSnapshot.mockResolvedValueOnce(snapshotFor(template));
    const result = await exportProjectThemeRepository('project_123');
    const archive = unzipSync(result.data);

    expect(result.fileName).toBe(`acme-docs-${template}-theme.zip`);
    expect(Object.keys(archive)).toEqual(
      expect.arrayContaining([
        'nibleaf.theme.json',
        '.nibleaf/content-map.json',
        '.nibleaf/snapshot.json',
        'src/nibleaf/runtime.ts',
        'src/adapters/content.ts',
        `src/theme/${componentName}.tsx`,
        `src/theme/${template}.css`,
        'src/theme/theme-utils.ts',
        'messages/en.json',
        'messages/ar.json',
        'content/main/en/welcome.mdx',
        'package.json',
        'README.md',
      ]),
    );
    expect(strFromU8(archive['package.json'] ?? new Uint8Array())).not.toContain('workspace:');
    expect(strFromU8(archive['package.json'] ?? new Uint8Array())).toContain('lucide-react');
    expect(strFromU8(archive[`src/theme/${componentName}.tsx`] ?? new Uint8Array())).toContain('../paraglide/messages.js');
    expect(strFromU8(archive['src/adapters/content.ts'] ?? new Uint8Array())).toContain('import.meta.glob');
    expect(strFromU8(archive['content/main/en/welcome.mdx'] ?? new Uint8Array())).toContain('Runnable fixture content.');
  });

  it('rejects colliding generated content paths before writing the archive', async () => {
    const snapshot = snapshotFor('harbor');
    const firstPage = snapshot.pages[0];
    expect(firstPage).toBeDefined();
    if (!firstPage) return;
    mocks.getCurrentSnapshot.mockResolvedValueOnce({
      ...snapshot,
      pages: [firstPage, { ...firstPage, id: 'welcome-duplicate', path: '/WELCOME' }],
    });

    await expect(exportProjectThemeRepository('project_123')).rejects.toThrow(/same theme repository path/);
  });
});
