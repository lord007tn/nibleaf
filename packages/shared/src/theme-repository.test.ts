import { describe, expect, it } from 'vitest';
import type { SiteSnapshot } from './site';
import {
  buildThemeRepository,
  THEME_REPOSITORY_MANIFEST_PATH,
  THEME_REPOSITORY_SNAPSHOT_PATH,
  themeContentPath,
  validateThemeRepositoryImport,
  validateThemeRepositoryManifest,
} from './theme-repository';

const snapshot: SiteSnapshot = {
  project: {
    id: 'project_123',
    name: 'Acme Docs',
    slug: 'acme-docs',
    description: 'A fixture that runs without production secrets.',
    icon: null,
    config: { theme: { preset: 'harbor' } },
    languages: [
      { code: 'en', label: 'English', direction: 'LTR', isDefault: true, enabled: true, config: null },
      { code: 'ar', label: 'العربية', direction: 'RTL', isDefault: false, enabled: true, config: null },
    ],
    versions: [{ id: 'version_main', name: 'Main', slug: 'main', isDefault: true }],
  },
  pages: [
    {
      id: 'page_welcome',
      parentId: null,
      versionId: 'version_main',
      languageCode: 'en',
      kind: 'PAGE',
      title: 'Welcome',
      slug: 'welcome',
      path: '/welcome',
      icon: null,
      description: 'Start building with Acme.',
      content: '## Overview\n\nFixture content.',
      config: null,
      translationKey: null,
      position: 0,
      hidden: false,
      updatedAt: '2026-08-23T00:00:00.000Z',
    },
  ],
  generatedAt: '2026-08-23T00:00:00.000Z',
};

describe('Git-native theme repository contract', () => {
  it('builds a self-contained Harbor repository with explicit ownership', () => {
    const files = buildThemeRepository(snapshot);
    const byPath = new Map(files.map((file) => [file.path, file]));
    expect(byPath.get('package.json')?.content).not.toContain('workspace:');
    expect(byPath.get('vite.config.ts')?.content).toContain('compiler: true');
    expect(byPath.get('vite.config.ts')?.content).toContain('paraglideVitePlugin');
    expect(byPath.get('src/env.ts')?.content).toContain('createEnv');
    expect(byPath.get('src/theme/HarborTheme.tsx')?.ownership).toBe('CUSTOMER');
    expect(byPath.get(THEME_REPOSITORY_SNAPSHOT_PATH)?.ownership).toBe('PLATFORM');
    const firstPage = snapshot.pages[0];
    expect(firstPage).toBeDefined();
    if (firstPage) expect(themeContentPath(firstPage, snapshot)).toBe('content/main/en/welcome.mdx');
    if (firstPage) expect(themeContentPath({ ...firstPage, path: '../../unsafe:name' }, snapshot)).toBe('content/main/en/unsafe-name.mdx');
  });

  it('accepts customer edits but rejects generated snapshot changes', () => {
    const files = new Map(buildThemeRepository(snapshot).map((file) => [file.path, file.content]));
    files.set('src/theme/HarborTheme.tsx', `${files.get('src/theme/HarborTheme.tsx')}\n// customer edit\n`);
    expect(validateThemeRepositoryImport(files, snapshot)).toEqual([]);
    files.set(THEME_REPOSITORY_SNAPSHOT_PATH, '{}\n');
    expect(validateThemeRepositoryImport(files, snapshot)).toEqual([
      expect.objectContaining({ path: THEME_REPOSITORY_SNAPSHOT_PATH, code: 'PLATFORM_FILE_MODIFIED' }),
    ]);
  });

  it('fails closed for an unknown manifest contract', () => {
    const files = new Map(buildThemeRepository(snapshot).map((file) => [file.path, file.content]));
    const manifestText = files.get(THEME_REPOSITORY_MANIFEST_PATH);
    expect(manifestText).toBeDefined();
    const manifest = JSON.parse(manifestText ?? '{}') as { runtime: { contractVersion: number } };
    manifest.runtime.contractVersion = 99;
    files.set(THEME_REPOSITORY_MANIFEST_PATH, `${JSON.stringify(manifest, null, 2)}\n`);
    expect(validateThemeRepositoryImport(files, snapshot).map((issue) => issue.code)).toContain('UNSUPPORTED_CONTRACT');
  });

  it('rejects a manifest connected to the wrong project before importing files', () => {
    const manifest = buildThemeRepository(snapshot).find((file) => file.path === THEME_REPOSITORY_MANIFEST_PATH)?.content;
    expect(validateThemeRepositoryManifest(manifest, 'another_project')).toEqual([
      expect.objectContaining({ code: 'MANIFEST_INVALID', message: expect.stringContaining('different Nibleaf project') }),
    ]);
  });
});
