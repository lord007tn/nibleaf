import { describe, expect, it } from 'vitest';
import type { SiteSnapshot, SnapshotPage } from './site';
import {
  buildThemeRepository,
  THEME_REPOSITORY_CONTENT_MAP_PATH,
  THEME_REPOSITORY_DOCS_CONFIG_PATH,
  THEME_REPOSITORY_LEGACY_MANIFEST_PATH,
  THEME_REPOSITORY_MANIFEST_PATH,
  themeContentLocation,
  themeContentPath,
  themeRepositoryOwnershipForPath,
  validateThemeRepositoryImport,
  validateThemeRepositoryManifest,
} from './theme-repository';
import { THEME_PRESETS, type ThemePresetId } from './themes';

const templates = [
  ['harbor', 'HarborLayout'],
  ['manuscript', 'ManuscriptLayout'],
  ['signal', 'SignalLayout'],
] as const satisfies ReadonlyArray<readonly [ThemePresetId, string]>;
const accentOf = (templateId: ThemePresetId, mode: 'light' | 'dark' = 'light') => THEME_PRESETS[templateId].colors[mode].accent;

const page = (overrides: Partial<SnapshotPage> & Pick<SnapshotPage, 'id' | 'title' | 'path'>): SnapshotPage => ({
  parentId: null,
  versionId: 'version_main',
  languageCode: 'en',
  kind: 'PAGE',
  slug: overrides.path.split('/').filter(Boolean).at(-1) ?? 'index',
  icon: null,
  description: null,
  content: '## Overview\n\nBody.',
  config: null,
  translationKey: null,
  position: 0,
  hidden: false,
  updatedAt: '2026-08-23T00:00:00.000Z',
  ...overrides,
});

const snapshot: SiteSnapshot = {
  project: {
    id: 'project_123',
    name: 'Acme Docs',
    slug: 'acme-docs',
    description: 'A fixture that runs without production secrets.',
    icon: null,
    config: { theme: { preset: 'harbor', layout: { density: 'compact' } }, styling: { theme: 'system' } },
    languages: [
      { code: 'en', label: 'English', direction: 'LTR', isDefault: true, enabled: true, config: null },
      { code: 'ar', label: 'العربية', direction: 'RTL', isDefault: false, enabled: true, config: null },
    ],
    versions: [
      { id: 'version_main', name: 'Main', slug: 'main', isDefault: true },
      { id: 'version_next', name: 'Next', slug: 'next', isDefault: false },
    ],
  },
  pages: [
    page({
      id: 'page_welcome',
      title: 'Welcome',
      path: '/welcome',
      description: 'Start building with Acme.',
      content:
        '## Overview\n\nFixture content with a <Tooltip tip="Auth token">credential</Tooltip> and <Icon icon="star" />.\n\n<Callout>\n\n**Portable callout**\n\n</Callout>',
    }),
    page({ id: 'group_guides', kind: 'GROUP', title: 'Guides', path: '/guides', position: 1, content: '' }),
    page({ id: 'page_auth', parentId: 'group_guides', title: 'Authentication', path: '/guides/authentication', position: 0 }),
    page({ id: 'page_hidden', title: 'Internal notes', path: '/internal', position: 2, hidden: true }),
    page({ id: 'page_welcome_ar', languageCode: 'ar', title: 'مرحبًا', path: '/مرحبا', translationKey: 'welcome' }),
    page({ id: 'page_auth_ar', languageCode: 'ar', title: 'المصادقة', path: '/المصادقة', position: 1 }),
    page({ id: 'page_next', versionId: 'version_next', title: 'Next release', path: '/next-release' }),
    page({ id: 'page_next_ar', versionId: 'version_next', languageCode: 'ar', title: 'الإصدار التالي', path: '/الإصدار-التالي' }),
  ],
  generatedAt: '2026-08-23T00:00:00.000Z',
};

const filesOf = (files: ReturnType<typeof buildThemeRepository>) => new Map(files.map((file) => [file.path, file]));
const docsOf = (files: ReturnType<typeof buildThemeRepository>) =>
  JSON.parse(filesOf(files).get(THEME_REPOSITORY_DOCS_CONFIG_PATH)?.content ?? '{}') as Record<string, any>;

describe('Git-native repository contract v2', () => {
  it.each(templates)('builds a runnable %s TanStack Start repository', (templateId, componentName) => {
    const files = buildThemeRepository(snapshot, { template: templateId });
    const byPath = filesOf(files);

    const packageJson = byPath.get('package.json');
    expect(packageJson?.ownership).toBe('CUSTOMER');
    expect(packageJson?.content).not.toContain('workspace:');
    expect(packageJson?.content).toContain('@tanstack/react-start');
    expect(packageJson?.content).toContain('tailwindcss');
    expect(packageJson?.content).toContain('rehype-sanitize');
    expect(byPath.get('vite.config.ts')?.content).toContain('tanstackStart({ prerender: { enabled: true, crawlLinks: true');
    expect(byPath.get('vite.config.ts')?.content).toContain('paraglideVitePlugin');

    const siteLib = byPath.get('src/lib/site.ts')?.content;
    expect(siteLib).toContain("import.meta.glob('../../content/**/*.mdx', { query: '?raw', import: 'default', eager: true })");
    expect(siteLib).toContain("import docsJson from '../../docs.json'");
    expect(siteLib).not.toMatch(/\b(?:fetch|readFile|readdir)\s*\(/);
    for (const route of ['src/routes/__root.tsx', 'src/routes/index.tsx', 'src/routes/$.tsx', 'src/router.tsx']) {
      expect(byPath.get(route)?.ownership).toBe('CUSTOMER');
    }
    expect(byPath.get('src/routes/__root.tsx')?.content).toContain('<html dir={dir} lang={lang}');

    const layout = byPath.get(`src/components/layout/${componentName}.tsx`);
    expect(layout?.ownership).toBe('CUSTOMER');
    expect(layout?.content).toContain('../../paraglide/messages.js');
    expect(byPath.get('src/components/layout/shared.tsx')?.content).toContain('rtl:-scale-x-100');
    expect(layout?.content).not.toContain('<select');
    expect(layout?.content).not.toMatch(/['"](?:Search documentation|Documentation|On this page|Chapters)['"]/u);
    expect(byPath.get('src/components/layout/index.tsx')?.content).toContain('site.theme.layout.shell');

    const styles = byPath.get('src/styles.css')?.content ?? '';
    expect(styles).toContain('@import "tailwindcss"');
    expect(styles).toContain('@theme inline');
    expect(styles).toContain(`  --theme-accent: ${accentOf(templateId)};`);
    expect(styles).toContain(`  --theme-accent: ${accentOf(templateId, 'dark')};`);
    expect(styles).toContain('\n.dark {\n');
    expect(styles.split('\n').length).toBeGreaterThan(200);
    expect(styles.split('\n').every((line) => line.length < 160)).toBe(true);

    expect(byPath.get('src/lib/markdown.tsx')?.content).toContain('rehypeSanitize, sanitizeSchema');
    expect(byPath.get('src/components/mdx/index.tsx')?.content).toContain('relatedcard: RelatedCard');
    expect(byPath.get('src/components/mdx/tooltip.tsx')?.content).toContain('role="tooltip"');
    expect(byPath.get('messages/ar.json')?.content).toContain('ابحث في التوثيق');
    expect(byPath.get('messages/en.json')?.content).toContain('No pages match this search.');

    const readme = byPath.get('README.md');
    expect(readme?.ownership).toBe('CUSTOMER');
    expect(readme?.content).toContain('corepack pnpm dev');
    expect(readme?.content).toContain('corepack pnpm build');
    expect(readme?.content).toContain('## Add a page');
    expect(readme?.content).toContain('| PLATFORM |');
    expect(readme?.content).toContain('| fumadocs | Mintlify | This repository |');

    expect(files.filter((file) => file.ownership === 'PLATFORM').map((file) => file.path)).toEqual([
      THEME_REPOSITORY_MANIFEST_PATH,
      THEME_REPOSITORY_DOCS_CONFIG_PATH,
      THEME_REPOSITORY_CONTENT_MAP_PATH,
    ]);
    expect(files.some((file) => file.path.includes('snapshot.json'))).toBe(false);
  });

  it('generates a Mintlify-compatible docs.json with the x-nibleaf block', () => {
    const files = buildThemeRepository(snapshot);
    const docs = docsOf(files);
    expect(docs.$schema).toBe('https://mintlify.com/docs.json');
    expect(docs.name).toBe('Acme Docs');
    expect(docs.colors).toEqual({ primary: accentOf('harbor'), light: accentOf('harbor', 'dark'), dark: accentOf('harbor') });
    expect(docs.navigation.versions).toHaveLength(2);
    const main = docs.navigation.versions[0];
    expect(main.version).toBe('Main');
    expect(main['x-nibleaf']).toEqual({ slug: 'main', default: true });
    expect(main.languages[0]).toEqual({
      language: 'en',
      'x-nibleaf': { label: 'English', direction: 'LTR', default: true },
      pages: [{ group: 'Guides', pages: ['guides/authentication'] }, 'welcome'],
    });
    expect(main.languages[1].pages).toEqual(['ar/مرحبا', 'ar/المصادقة']);
    expect(docs.navigation.versions[1].languages[0].pages).toEqual(['versions/next/next-release']);
    expect(docs['x-nibleaf'].template).toEqual({ id: 'harbor', version: 2 });
    expect(docs['x-nibleaf'].theme.id).toBe('harbor');
    expect(docs['x-nibleaf'].theme.layout.density).toBe('compact');
    expect(docs['x-nibleaf'].appearance).toBe('system');
    expect(docs['x-nibleaf'].languages).toEqual([
      { code: 'en', label: 'English', direction: 'LTR', isDefault: true, enabled: true, directory: '' },
      { code: 'ar', label: 'العربية', direction: 'RTL', isDefault: false, enabled: true, directory: 'ar' },
    ]);
    expect(docs['x-nibleaf'].versions[1]).toEqual({ id: 'version_next', name: 'Next', slug: 'next', isDefault: false, directory: 'versions/next' });
    expect(docs['x-nibleaf'].contentPath).toBe('content');
    expect(JSON.stringify(docs)).not.toContain('Internal notes');
  });

  it('is deterministic for the same snapshot', () => {
    const first = buildThemeRepository(snapshot).map((file) => [file.path, file.content]);
    const second = buildThemeRepository(snapshot).map((file) => [file.path, file.content]);
    expect(second).toEqual(first);
  });

  it('places pages in the content tree by language and version and keeps Arabic slugs readable', () => {
    const byId = new Map(snapshot.pages.map((item) => [item.id, item]));
    const pathOf = (id: string) => themeContentPath(byId.get(id) as SnapshotPage, snapshot);
    expect(pathOf('page_welcome')).toBe('content/welcome.mdx');
    expect(pathOf('page_auth')).toBe('content/guides/authentication.mdx');
    expect(pathOf('page_auth_ar')).toBe('content/ar/المصادقة.mdx');
    expect(pathOf('page_next')).toBe('content/versions/next/next-release.mdx');
    expect(pathOf('page_next_ar')).toBe('content/versions/next/ar/الإصدار-التالي.mdx');
    expect(themeContentPath({ ...(byId.get('page_welcome') as SnapshotPage), path: '../../unsafe:name' }, snapshot)).toBe(
      'content/unsafe~3a~name.mdx',
    );
    expect(themeContentPath(byId.get('page_welcome') as SnapshotPage, snapshot, '')).toBe('welcome.mdx');

    const contentMap = JSON.parse(filesOf(buildThemeRepository(snapshot)).get(THEME_REPOSITORY_CONTENT_MAP_PATH)?.content ?? '{}');
    expect(contentMap).toEqual({
      page_welcome: 'content/welcome.mdx',
      page_auth: 'content/guides/authentication.mdx',
      page_hidden: 'content/internal.mdx',
      page_welcome_ar: 'content/ar/مرحبا.mdx',
      page_auth_ar: 'content/ar/المصادقة.mdx',
      page_next: 'content/versions/next/next-release.mdx',
      page_next_ar: 'content/versions/next/ar/الإصدار-التالي.mdx',
    });
  });

  it('reads a repository path back to its version and language', () => {
    expect(themeContentLocation('content/welcome.mdx', snapshot)).toEqual({ versionId: 'version_main', languageCode: 'en', relative: 'welcome' });
    expect(themeContentLocation('content/ar/المصادقة.mdx', snapshot)).toEqual({
      versionId: 'version_main',
      languageCode: 'ar',
      relative: 'المصادقة',
    });
    expect(themeContentLocation('content/versions/next/ar/x.mdx', snapshot)).toEqual({
      versionId: 'version_next',
      languageCode: 'ar',
      relative: 'x',
    });
    expect(themeContentLocation('content/guides/index.mdx', snapshot)).toEqual({
      versionId: 'version_main',
      languageCode: 'en',
      relative: 'guides/index',
    });
    expect(themeContentLocation('docs/welcome.mdx', snapshot)).toBeNull();
    expect(themeContentLocation('README.md', snapshot)).toBeNull();
    expect(themeContentLocation('welcome.mdx', snapshot, '')).toEqual({ versionId: 'version_main', languageCode: 'en', relative: 'welcome' });
  });

  it('rejects page paths that would read back as another language or version', () => {
    const welcome = snapshot.pages[0] as SnapshotPage;
    expect(() => buildThemeRepository({ ...snapshot, pages: [{ ...welcome, path: '/ar/welcome' }] })).toThrow(/different language or version/);
    expect(() => buildThemeRepository({ ...snapshot, pages: [{ ...welcome, path: '/versions/next/welcome' }] })).toThrow(
      /different language or version/,
    );
  });

  it('preserves distinct unsafe path segments and rejects case-insensitive output collisions', () => {
    const welcome = snapshot.pages[0] as SnapshotPage;
    expect(themeContentPath({ ...welcome, path: '/unsafe:name' }, snapshot)).not.toBe(
      themeContentPath({ ...welcome, path: '/unsafe?name' }, snapshot),
    );
    expect(() => buildThemeRepository({ ...snapshot, pages: [welcome, { ...welcome, id: 'page_collision', path: '/WELCOME' }] })).toThrow(
      /same theme repository path/,
    );
  });

  it('classifies ownership by path', () => {
    expect(themeRepositoryOwnershipForPath(THEME_REPOSITORY_MANIFEST_PATH)).toBe('PLATFORM');
    expect(themeRepositoryOwnershipForPath(THEME_REPOSITORY_DOCS_CONFIG_PATH)).toBe('PLATFORM');
    expect(themeRepositoryOwnershipForPath(THEME_REPOSITORY_LEGACY_MANIFEST_PATH)).toBe('PLATFORM');
    expect(themeRepositoryOwnershipForPath('.nibleaf/snapshot.json')).toBe('PLATFORM');
    expect(themeRepositoryOwnershipForPath('content/ar/المصادقة.mdx')).toBe('SHARED');
    expect(themeRepositoryOwnershipForPath('docs/welcome.mdx', 'docs')).toBe('SHARED');
    expect(themeRepositoryOwnershipForPath('welcome.mdx', '')).toBe('SHARED');
    expect(themeRepositoryOwnershipForPath('README.md', '')).toBe('CUSTOMER');
    expect(themeRepositoryOwnershipForPath('src/components/layout/HarborLayout.tsx')).toBe('CUSTOMER');
    expect(themeRepositoryOwnershipForPath('src/styles.css')).toBe('CUSTOMER');
    expect(themeRepositoryOwnershipForPath('messages/ar.json')).toBe('CUSTOMER');
    expect(themeRepositoryOwnershipForPath('package.json')).toBe('CUSTOMER');
    expect(themeRepositoryOwnershipForPath('public/logo.png')).toBeNull();
    expect(themeRepositoryOwnershipForPath('unmanaged.txt')).toBeNull();
    const manifest = JSON.parse(
      filesOf(buildThemeRepository(snapshot, { contentPath: '/docs/' })).get(THEME_REPOSITORY_MANIFEST_PATH)?.content ?? '{}',
    );
    expect(manifest.schemaVersion).toBe(2);
    expect(manifest.template).toEqual({ id: 'harbor', version: 2 });
    expect(manifest.contentPath).toBe('docs');
    expect(manifest.ownership).toEqual({
      platform: ['.nibleaf/**', 'docs.json'],
      shared: ['docs/**/*.mdx'],
      customer: [
        'src/**',
        'messages/**',
        'project.inlang/**',
        'public/**',
        'README.md',
        'package.json',
        'tsconfig.json',
        'vite.config.ts',
        'vitest.config.ts',
        '.gitignore',
      ],
    });
    expect(manifest.docs.sha256).toMatch(/^[0-9a-f]{64}$/);
    expect(manifest).not.toHaveProperty('snapshot');
  });

  it('documents the configured content root in the generated repository', () => {
    const files = new Map(buildThemeRepository(snapshot, { contentPath: '/docs/' }).map((file) => [file.path, file.content]));
    expect(files.get('README.md')).toContain('`docs/**/*.mdx`');
    expect(files.get('src/lib/site.ts')).toContain("import.meta.glob('../../docs/**/*.mdx'");
    expect(docsOf(buildThemeRepository(snapshot, { contentPath: '/docs/' }))['x-nibleaf'].contentPath).toBe('docs');
  });

  it('accepts customer edits but rejects generated platform changes', () => {
    const files = new Map(buildThemeRepository(snapshot).map((file) => [file.path, file.content]));
    files.set('src/components/layout/HarborLayout.tsx', `${files.get('src/components/layout/HarborLayout.tsx')}\n// customer edit\n`);
    files.set('content/welcome.mdx', '---\ntitle: "Welcome"\n---\n\nEdited in Git.');
    expect(validateThemeRepositoryImport(files, snapshot)).toEqual([]);
    files.set(THEME_REPOSITORY_DOCS_CONFIG_PATH, '{}\n');
    expect(validateThemeRepositoryImport(files, snapshot)).toEqual([
      expect.objectContaining({ path: THEME_REPOSITORY_DOCS_CONFIG_PATH, code: 'PLATFORM_FILE_MODIFIED' }),
    ]);
  });

  it('rejects importing one template contract into a project configured for another', () => {
    const files = new Map(buildThemeRepository(snapshot, { template: 'signal' }).map((file) => [file.path, file.content]));
    expect(validateThemeRepositoryImport(files, snapshot)).toContainEqual(
      expect.objectContaining({ path: THEME_REPOSITORY_MANIFEST_PATH, code: 'MANIFEST_INVALID', message: expect.stringContaining('signal') }),
    );
  });

  it('fails closed for a schema v1 repository with a clear message', () => {
    const legacy = JSON.stringify({
      kind: 'nibleaf-theme-repository',
      schemaVersion: 1,
      project: { id: 'project_123', slug: 'acme-docs' },
      template: { id: 'harbor', version: 1 },
      runtime: { strategy: 'vendored', contractVersion: 1, entry: 'src/nibleaf/runtime.ts' },
    });
    expect(validateThemeRepositoryManifest(legacy, 'project_123')).toEqual([
      expect.objectContaining({
        path: THEME_REPOSITORY_LEGACY_MANIFEST_PATH,
        code: 'MANIFEST_INVALID',
        message: expect.stringContaining('schema v1'),
      }),
    ]);
    const files = new Map([
      [THEME_REPOSITORY_LEGACY_MANIFEST_PATH, legacy],
      ['.nibleaf/snapshot.json', '{}\n'],
    ]);
    expect(validateThemeRepositoryImport(files, snapshot).map((issue) => issue.message)).toEqual([expect.stringContaining('no longer supported')]);
    expect(validateThemeRepositoryManifest(undefined)).toEqual([
      expect.objectContaining({ code: 'MANIFEST_INVALID', message: expect.stringContaining('v2') }),
    ]);
  });

  it('fails closed for an unknown runtime contract', () => {
    const files = new Map(buildThemeRepository(snapshot).map((file) => [file.path, file.content]));
    const manifest = JSON.parse(files.get(THEME_REPOSITORY_MANIFEST_PATH) ?? '{}') as { runtime: { contractVersion: number } };
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
