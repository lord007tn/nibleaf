import { strFromU8, unzipSync } from 'fflate';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({ getCurrentSnapshot: vi.fn() }));
const templates = [
  ['harbor', 'HarborLayout'],
  ['manuscript', 'ManuscriptLayout'],
  ['signal', 'SignalLayout'],
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
        '.nibleaf/manifest.json',
        '.nibleaf/content-map.json',
        'docs.json',
        'src/lib/site.ts',
        'src/routes/$.tsx',
        `src/components/layout/${componentName}.tsx`,
        'src/styles.css',
        'messages/en.json',
        'messages/ar.json',
        'content/welcome.mdx',
        'package.json',
        'README.md',
      ]),
    );
    expect(Object.keys(archive)).not.toContain('.nibleaf/snapshot.json');
    expect(strFromU8(archive['package.json'] ?? new Uint8Array())).not.toContain('workspace:');
    expect(strFromU8(archive['package.json'] ?? new Uint8Array())).toContain('@tanstack/react-start');
    expect(strFromU8(archive[`src/components/layout/${componentName}.tsx`] ?? new Uint8Array())).toContain('../../paraglide/messages.js');
    expect(strFromU8(archive['src/lib/site.ts'] ?? new Uint8Array())).toContain('import.meta.glob');
    expect(JSON.parse(strFromU8(archive['docs.json'] ?? new Uint8Array()))['x-nibleaf'].template).toEqual({ id: template, version: 2 });
    expect(strFromU8(archive['content/welcome.mdx'] ?? new Uint8Array())).toContain('Runnable fixture content.');
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
