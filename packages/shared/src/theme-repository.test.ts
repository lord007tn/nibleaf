import { describe, expect, it } from 'vitest';
import type { SiteSnapshot } from './site';
import {
  buildThemeRepository,
  THEME_REPOSITORY_CONTENT_MAP_PATH,
  THEME_REPOSITORY_MANIFEST_PATH,
  THEME_REPOSITORY_SNAPSHOT_PATH,
  themeContentPath,
  validateThemeRepositoryImport,
  validateThemeRepositoryManifest,
} from './theme-repository';
import type { ThemePresetId } from './themes';

const templates = [
  ['harbor', 'HarborTheme'],
  ['manuscript', 'ManuscriptTheme'],
  ['signal', 'SignalTheme'],
] as const satisfies ReadonlyArray<readonly [ThemePresetId, string]>;

const snapshot: SiteSnapshot = {
  project: {
    id: 'project_123',
    name: 'Acme Docs',
    slug: 'acme-docs',
    description: 'A fixture that runs without production secrets.',
    icon: null,
    config: { theme: { preset: 'harbor', layout: { density: 'compact' } } },
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
      content:
        '## Overview\n\nFixture content with a <Tooltip tip="Auth token">credential</Tooltip> and <Icon icon="star" />.\n\n<Callout>\n\n**Portable callout**\n\n</Callout>',
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
  it.each(templates)('builds a self-contained %s repository with localized editable code', (templateId, componentName) => {
    const files = buildThemeRepository(snapshot, { template: templateId });
    const byPath = new Map(files.map((file) => [file.path, file]));
    expect(byPath.get('package.json')?.content).not.toContain('workspace:');
    expect(byPath.get('package.json')?.content).toContain('lucide-react');
    expect(byPath.get('package.json')?.content).toContain('rehype-sanitize');
    expect(byPath.get('vite.config.ts')?.content).toContain('compiler: true');
    expect(byPath.get('vite.config.ts')?.content).toContain('paraglideVitePlugin');
    expect(byPath.get('src/env.ts')?.content).toContain('createEnv');
    expect(byPath.get('src/adapters/content.ts')?.content).toContain('import.meta.glob');
    expect(byPath.get('src/adapters/content.ts')?.content).toContain('applyMdxFiles');
    expect(byPath.get('src/adapters/content.test.ts')?.content).toContain('## Customer edit');
    const mdxComponents = byPath.get('src/theme/mdx-components.tsx')?.content;
    expect(mdxComponents).toContain("'next-steps'");
    expect(mdxComponents).toContain('aria-describedby={id}');
    expect(mdxComponents).toContain('role="tooltip"');
    expect(mdxComponents).not.toMatch(/\btypeof\b|\bas unknown as\b|\bas Array<ReactElement/);
    expect(byPath.get('src/theme/theme-utils.ts')?.content).toContain('documentationSanitizeSchema');
    expect(byPath.get('src/theme/mdx-components.tsx')?.content).toContain('relatedcard: RelatedCard');
    expect(byPath.get('src/theme/theme-utils.ts')?.content).not.toMatch(/\b(?:fetch|readFile|readdir|glob)\s*\(/);
    expect(byPath.get('src/theme/mdx-components.tsx')?.content).not.toMatch(/\b(?:fetch|readFile|readdir|glob)\s*\(/);
    expect(byPath.get(THEME_REPOSITORY_CONTENT_MAP_PATH)?.ownership).toBe('PLATFORM');
    const component = byPath.get(`src/theme/${componentName}.tsx`);
    expect(component?.content).toContain('../paraglide/messages.js');
    expect(component?.content).toContain("from 'lucide-react'");
    expect(component?.content).toContain('normalizeDocumentationMarkdown(page.content)');
    expect(component?.content).not.toMatch(/[⌕↗]/u);
    expect(component?.content).not.toMatch(
      /['"](?:Search documentation|GitHub|Documentation|Choose documentation page|On this page|Overview|Next steps|Chapters|Command index|Customer-owned component|Nibleaf sync preserves it)['"]/u,
    );
    expect(component?.ownership).toBe('CUSTOMER');
    const themeStyles = byPath.get(`src/theme/${templateId}.css`);
    expect(themeStyles?.ownership).toBe('CUSTOMER');
    expect(themeStyles?.content).toContain('.mdx-tooltip:hover .mdx-tooltip-content');
    expect(themeStyles?.content).toContain('.mdx-tooltip:focus-within .mdx-tooltip-content');
    expect(byPath.get('messages/ar.json')?.content).toContain('اختر صفحة التوثيق');
    expect(JSON.parse(byPath.get(THEME_REPOSITORY_MANIFEST_PATH)?.content ?? '{}').template).toEqual({ id: templateId, version: 1 });
    expect(JSON.parse(byPath.get(THEME_REPOSITORY_SNAPSHOT_PATH)?.content ?? '{}').project.config.theme).toEqual({
      preset: templateId,
      layout: { density: 'compact' },
    });
    expect(byPath.get(THEME_REPOSITORY_SNAPSHOT_PATH)?.ownership).toBe('PLATFORM');
    const firstPage = snapshot.pages[0];
    expect(firstPage).toBeDefined();
    if (firstPage) expect(themeContentPath(firstPage, snapshot)).toBe('content/main/en/welcome.mdx');
    if (firstPage) expect(themeContentPath({ ...firstPage, path: '../../unsafe:name' }, snapshot)).toBe('content/main/en/unsafe~3a~name.mdx');
  });

  it('documents the configured content root in the generated repository', () => {
    const files = new Map(buildThemeRepository(snapshot, { contentPath: '/docs/' }).map((file) => [file.path, file.content]));
    expect(files.get('README.md')).toContain('documentation MDX under `docs/`');
    expect(files.get('src/adapters/content.ts')).toContain('../../docs/**/*.mdx');
  });

  it('preserves distinct unsafe path segments and rejects case-insensitive output collisions', () => {
    const firstPage = snapshot.pages[0];
    expect(firstPage).toBeDefined();
    if (!firstPage) return;
    expect(themeContentPath({ ...firstPage, path: '/unsafe:name' }, snapshot)).not.toBe(
      themeContentPath({ ...firstPage, path: '/unsafe?name' }, snapshot),
    );
    expect(() =>
      buildThemeRepository({
        ...snapshot,
        pages: [firstPage, { ...firstPage, id: 'page_collision', path: '/WELCOME' }],
      }),
    ).toThrow(/same theme repository path/);
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

  it('rejects importing one template contract into a project configured for another', () => {
    const files = new Map(buildThemeRepository(snapshot, { template: 'signal' }).map((file) => [file.path, file.content]));
    expect(validateThemeRepositoryImport(files, snapshot)).toContainEqual(
      expect.objectContaining({ path: THEME_REPOSITORY_MANIFEST_PATH, code: 'MANIFEST_INVALID', message: expect.stringContaining('signal') }),
    );
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

  it('validates the configured content root and rejects extra platform files', () => {
    const files = new Map(buildThemeRepository(snapshot, { contentPath: 'docs' }).map((file) => [file.path, file.content]));
    expect(validateThemeRepositoryImport(files, snapshot, 'docs')).toEqual([]);

    files.set('.nibleaf/extra.json', '{}\n');
    expect(validateThemeRepositoryImport(files, snapshot, 'docs')).toContainEqual(
      expect.objectContaining({ path: '.nibleaf/extra.json', code: 'PLATFORM_FILE_MODIFIED' }),
    );
  });

  it('rejects a manifest connected to the wrong project before importing files', () => {
    const manifest = buildThemeRepository(snapshot).find((file) => file.path === THEME_REPOSITORY_MANIFEST_PATH)?.content;
    expect(validateThemeRepositoryManifest(manifest, 'another_project')).toEqual([
      expect.objectContaining({ code: 'MANIFEST_INVALID', message: expect.stringContaining('different Nibleaf project') }),
    ]);
  });
});
