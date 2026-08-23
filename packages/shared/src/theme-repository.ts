import { createHash } from 'node:crypto';
import type { SiteSnapshot, SnapshotPage } from './site';
import { THEME_REPOSITORY_TEMPLATE_SOURCES, type ThemeRepositoryTemplateSource, themeUtilitiesSource } from './theme-repository-templates';
import { THEME_PRESET_IDS, type ThemePresetId } from './themes';

export const THEME_REPOSITORY_SCHEMA_VERSION = 1 as const;
export const THEME_RUNTIME_CONTRACT_VERSION = 1 as const;
export const THEME_REPOSITORY_KIND = 'nibleaf-theme-repository' as const;
export const THEME_REPOSITORY_MANIFEST_PATH = 'nibleaf.theme.json' as const;
export const THEME_REPOSITORY_SNAPSHOT_PATH = '.nibleaf/snapshot.json' as const;
export const THEME_REPOSITORY_CONTENT_MAP_PATH = '.nibleaf/content-map.json' as const;

export type ThemeRepositoryOwnership = 'PLATFORM' | 'SHARED' | 'CUSTOMER';

export interface ThemeRepositoryFile {
  path: string;
  content: string;
  ownership: ThemeRepositoryOwnership;
}

export interface ThemeRepositoryManifestV1 {
  kind: typeof THEME_REPOSITORY_KIND;
  schemaVersion: typeof THEME_REPOSITORY_SCHEMA_VERSION;
  project: { id: string; slug: string };
  template: { id: ThemePresetId; version: 1 };
  runtime: { strategy: 'vendored'; contractVersion: typeof THEME_RUNTIME_CONTRACT_VERSION; entry: 'src/nibleaf/runtime.ts' };
  snapshot: { path: typeof THEME_REPOSITORY_SNAPSHOT_PATH; sha256: string };
  ownership: { platform: readonly string[]; shared: readonly string[]; customer: readonly string[] };
}

export interface ThemeRepositoryImportIssue {
  path: string;
  code: 'MANIFEST_INVALID' | 'PLATFORM_FILE_MODIFIED' | 'UNSUPPORTED_CONTRACT' | 'UNSUPPORTED_TEMPLATE';
  message: string;
}

const record = (value: unknown): Record<string, unknown> | undefined =>
  typeof value === 'object' && value !== null && !Array.isArray(value) ? (value as Record<string, unknown>) : undefined;

export const themeRepositoryTemplateId = (snapshot: SiteSnapshot, override?: ThemePresetId): ThemePresetId => {
  if (override) return override;
  const configured = record(record(snapshot.project.config)?.theme)?.preset;
  return typeof configured === 'string' && THEME_PRESET_IDS.includes(configured as ThemePresetId) ? (configured as ThemePresetId) : 'harbor';
};

export const validateThemeRepositoryManifest = (
  manifestText: string | undefined,
  expectedProjectId?: string,
  expectedTemplateId?: ThemePresetId,
): ThemeRepositoryImportIssue[] => {
  const issues: ThemeRepositoryImportIssue[] = [];
  let manifest: Partial<ThemeRepositoryManifestV1> | undefined;
  try {
    manifest = manifestText ? (JSON.parse(manifestText) as Partial<ThemeRepositoryManifestV1>) : undefined;
  } catch {
    manifest = undefined;
  }
  if (!manifest || manifest.kind !== THEME_REPOSITORY_KIND || manifest.schemaVersion !== THEME_REPOSITORY_SCHEMA_VERSION) {
    return [{ path: THEME_REPOSITORY_MANIFEST_PATH, code: 'MANIFEST_INVALID', message: 'Use an unchanged Nibleaf theme repository manifest v1.' }];
  }
  if (expectedProjectId && manifest.project?.id !== expectedProjectId) {
    issues.push({
      path: THEME_REPOSITORY_MANIFEST_PATH,
      code: 'MANIFEST_INVALID',
      message: 'The theme repository belongs to a different Nibleaf project.',
    });
  }
  if (manifest.runtime?.contractVersion !== THEME_RUNTIME_CONTRACT_VERSION) {
    issues.push({ path: THEME_REPOSITORY_MANIFEST_PATH, code: 'UNSUPPORTED_CONTRACT', message: 'This Nibleaf runtime contract is not supported.' });
  }
  const templateId = manifest.template?.id;
  if (!(typeof templateId === 'string' && THEME_PRESET_IDS.includes(templateId as ThemePresetId)) || manifest.template?.version !== 1) {
    issues.push({
      path: THEME_REPOSITORY_MANIFEST_PATH,
      code: 'UNSUPPORTED_TEMPLATE',
      message: 'This repository must use Harbor, Manuscript, or Signal template contract v1.',
    });
  } else if (expectedTemplateId && templateId !== expectedTemplateId) {
    issues.push({
      path: THEME_REPOSITORY_MANIFEST_PATH,
      code: 'MANIFEST_INVALID',
      message: `This repository contains ${templateId}, but the Nibleaf project is configured for ${expectedTemplateId}.`,
    });
  }
  return issues;
};

const json = (value: unknown): string => `${JSON.stringify(value, null, 2)}\n`;
const sha256 = (value: string): string => createHash('sha256').update(value).digest('hex');
const stableSnapshot = (snapshot: SiteSnapshot): SiteSnapshot => ({
  ...snapshot,
  generatedAt:
    snapshot.pages
      .map((page) => page.updatedAt)
      .sort()
      .at(-1) ?? '1970-01-01T00:00:00.000Z',
});

const packageJson = (templateId: ThemePresetId) =>
  json({
    name: `nibleaf-${templateId}-theme`,
    private: true,
    version: '0.1.0',
    type: 'module',
    engines: { node: '>=22.13.0', pnpm: '>=10.0.0' },
    packageManager: 'pnpm@10.30.3',
    scripts: {
      paraglide: 'paraglide-js compile --project ./project.inlang --outdir ./src/paraglide',
      dev: 'pnpm paraglide && vite',
      build: 'pnpm paraglide && tsc --noEmit && vite build',
      test: 'pnpm paraglide && vitest run',
      check: 'pnpm paraglide && vitest run && tsc --noEmit && vite build',
    },
    dependencies: {
      '@t3-oss/env-core': '^0.13.11',
      'lucide-react': '1.21.0',
      react: '^19.2.4',
      'react-dom': '^19.2.4',
      'react-markdown': '^10.1.0',
      'remark-gfm': '^4.0.1',
      zod: '^4.4.3',
    },
    devDependencies: {
      '@inlang/paraglide-js': '2.24.1',
      '@types/node': '^22.15.0',
      '@types/react': '^19.2.0',
      '@types/react-dom': '^19.2.0',
      '@vitejs/plugin-react': '^6.1.0',
      'oxc-transform-react': '0.145.0',
      typescript: '^7.0.2',
      vite: '^8.2.2',
      vitest: '^3.2.4',
    },
  });

const tsconfig = json({
  compilerOptions: {
    target: 'ES2023',
    useDefineForClassFields: true,
    lib: ['ES2023', 'DOM', 'DOM.Iterable'],
    allowJs: true,
    skipLibCheck: true,
    esModuleInterop: true,
    allowSyntheticDefaultImports: true,
    strict: true,
    forceConsistentCasingInFileNames: true,
    module: 'ESNext',
    moduleResolution: 'Bundler',
    resolveJsonModule: true,
    isolatedModules: true,
    noEmit: true,
    jsx: 'react-jsx',
    types: ['vite/client', 'node'],
  },
  include: ['src', 'vite.config.ts'],
});

const viteConfig = `import { paraglideVitePlugin } from '@inlang/paraglide-js';
import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

export default defineConfig({
  plugins: [
    paraglideVitePlugin({ project: './project.inlang', outdir: './src/paraglide' }),
    react({ compiler: true }),
  ],
});
`;

const envSource = `import { createEnv } from '@t3-oss/env-core';
import { z } from 'zod';

export const env = createEnv({
  clientPrefix: 'VITE_',
  client: { VITE_NIBLEAF_API_URL: z.url().optional() },
  runtimeEnv: import.meta.env,
  emptyStringAsUndefined: true,
});
`;

const runtimeSource = `import { z } from 'zod';
import snapshotJson from '../../.nibleaf/snapshot.json';

export const NIBLEAF_THEME_RUNTIME_CONTRACT = 1 as const;

const languageSchema = z.object({
  code: z.string().min(1), label: z.string().min(1), direction: z.enum(['LTR', 'RTL']),
  isDefault: z.boolean(), enabled: z.boolean().optional(), config: z.record(z.string(), z.unknown()).nullable(),
});
const versionSchema = z.object({ id: z.string(), name: z.string(), slug: z.string(), isDefault: z.boolean() });
const pageSchema = z.object({
  id: z.string(), parentId: z.string().nullable(), versionId: z.string(), languageCode: z.string(),
  kind: z.enum(['PAGE', 'GROUP']), title: z.string(), slug: z.string(), path: z.string(),
  icon: z.string().nullable(), description: z.string().nullable(), content: z.string(),
  config: z.record(z.string(), z.unknown()).nullable(), translationKey: z.string().nullable(),
  position: z.number(), hidden: z.boolean(), updatedAt: z.string(), createdAt: z.string().optional(),
});
export const siteSnapshotSchema = z.object({
  project: z.object({
    id: z.string(), name: z.string(), slug: z.string(), description: z.string().nullable(), icon: z.string().nullable(),
    config: z.record(z.string(), z.unknown()).nullable(), languages: z.array(languageSchema).min(1), versions: z.array(versionSchema).min(1),
  }),
  pages: z.array(pageSchema), generatedAt: z.string(), openapi: z.record(z.string(), z.unknown()).nullable().optional(),
});

export type SiteSnapshot = z.infer<typeof siteSnapshotSchema>;
export type SitePage = z.infer<typeof pageSchema>;
export const loadSnapshot = (): SiteSnapshot => siteSnapshotSchema.parse(snapshotJson);
`;

const adapterSource = (contentPath = 'content') => {
  const root = normalizedContentPath(contentPath);
  const contentGlob = `../../${root ? `${root}/` : ''}**/*.mdx`;
  return `import contentMapJson from '../../${THEME_REPOSITORY_CONTENT_MAP_PATH}';
import { env } from '../env';
import { loadSnapshot, type SiteSnapshot } from '../nibleaf/runtime';

export interface ContentAdapter { load(): Promise<SiteSnapshot> }

const contentMap = contentMapJson as Record<string, string>;
const mdxFiles = import.meta.glob(${JSON.stringify(contentGlob)}, { eager: true, import: 'default', query: '?raw' }) as Record<string, string>;

const repositoryPath = (modulePath: string): string => modulePath.startsWith('../../') ? modulePath.slice(6) : modulePath;
const stripFrontMatter = (source: string): string => {
  const normalized = source.replaceAll('\\r', '');
  if (!normalized.startsWith('---\\n')) return normalized;
  const boundary = normalized.indexOf('\\n---\\n', 4);
  return boundary === -1 ? normalized : normalized.slice(boundary + 5).trimStart();
};

export const applyMdxFiles = (snapshot: SiteSnapshot, sources: Readonly<Record<string, string>>): SiteSnapshot => {
  const byPath = new Map(Object.entries(sources).map(([path, source]) => [repositoryPath(path), source]));
  return {
    ...snapshot,
    pages: snapshot.pages.map((page) => {
      const path = contentMap[page.id];
      const source = path ? byPath.get(path) : undefined;
      return source === undefined ? page : { ...page, content: stripFrontMatter(source) };
    }),
  };
};

/** Local development never needs production secrets. Replace this adapter to
 * opt into a versioned Nibleaf API once an official remote SDK is available. */
export const contentAdapter: ContentAdapter = {
  async load() {
    void env.VITE_NIBLEAF_API_URL;
    return applyMdxFiles(loadSnapshot(), mdxFiles);
  },
};
`;
};

const adapterTestSource = `import contentMapJson from '../../.nibleaf/content-map.json';
import { describe, expect, it } from 'vitest';
import { loadSnapshot } from '../nibleaf/runtime';
import { applyMdxFiles } from './content';

describe('content adapter', () => {
  it('uses customer-edited MDX content instead of the generated snapshot body', () => {
    const snapshot = loadSnapshot();
    const page = snapshot.pages.find((item) => item.kind === 'PAGE');
    expect(page).toBeDefined();
    if (!page) return;
    const path = (contentMapJson as Record<string, string>)[page.id];
    expect(path).toBeDefined();
    if (!path) return;
    const edited = applyMdxFiles(snapshot, { [\`../../\${path}\`]: '---\\ntitle: "Edited"\\n---\\n\\n## Customer edit' });
    expect(edited.pages.find((item) => item.id === page.id)?.content).toBe('## Customer edit');
  });
});
`;

const appSource = (template: ThemeRepositoryTemplateSource, templateId: ThemePresetId) => `import { useEffect, useState } from 'react';
import * as m from './paraglide/messages.js';
import { contentAdapter } from './adapters/content';
import type { SiteSnapshot } from './nibleaf/runtime';
import { ${template.componentName} } from './theme/${template.componentName}';
import './theme/${templateId}.css';

export function App() {
  const [snapshot, setSnapshot] = useState<SiteSnapshot>();
  useEffect(() => { void contentAdapter.load().then(setSnapshot); }, []);
  return snapshot ? <${template.componentName} snapshot={snapshot} /> : <p className="loading">{m.loading()}</p>;
}
`;

const mainSource = `import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './App';

createRoot(document.getElementById('root')!).render(<StrictMode><App /></StrictMode>);
`;

const testSource = (template: ThemeRepositoryTemplateSource) => `import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import * as m from '../paraglide/messages.js';
import { loadSnapshot } from '../nibleaf/runtime';
import { ${template.componentName} } from './${template.componentName}';

describe('${template.displayName} theme', () => {
  it('renders localized fixture content through the vendored runtime contract', () => {
    const snapshot = loadSnapshot();
    const english = renderToStaticMarkup(<${template.componentName} snapshot={snapshot} />);
    expect(english).toContain(m.customerOwned({}, { locale: 'en' }));
    expect(english).toContain(m.themeLabel({}, { locale: 'en' }));
    const arabicPage = snapshot.pages.find((page) => page.languageCode === 'ar');
    expect(arabicPage).toBeDefined();
    if (!arabicPage) return;
    const arabic = renderToStaticMarkup(<${template.componentName} snapshot={{ ...snapshot, pages: [arabicPage] }} />);
    expect(arabic).toContain('dir="rtl"');
    expect(arabic).toContain(m.themeLabel({}, { locale: 'ar' }));
  });
});
`;

const readme = (projectName: string, template: ThemeRepositoryTemplateSource, templateId: ThemePresetId) => `# ${projectName} documentation theme

This is a normal, self-contained ${template.displayName} implementation exported by Nibleaf. It uses Vite 8, React Compiler, TypeScript 7, ParaglideJS, Lucide, typed t3-env validation, and a vendored Nibleaf runtime contract. It does not need production secrets or a Nibleaf monorepo checkout.

## One-command local setup

\`corepack pnpm install && corepack pnpm dev\`

Then open the URL printed by Vite. Run \`corepack pnpm check\` before pushing.

## Extension points and ownership

- Edit \`src/theme/${template.componentName}.tsx\` and \`src/theme/${templateId}.css\` for layout and presentation.
- Edit \`src/theme/theme-utils.ts\` only when changing the shared page, locale, or document-direction behavior.
- Edit \`messages/*.json\` for translated chrome; every visible runtime label is read through Paraglide.
- Replace or wrap \`src/adapters/content.ts\` to change how data is loaded.
- Put static assets in \`public/\`.
- Edit documentation MDX under \`content/\`; Nibleaf and Git reconcile it with the recorded common base.
- Do not hand-edit \`.nibleaf/\` or \`nibleaf.theme.json\`. Nibleaf regenerates and verifies those files.

The manifest is the source of truth for ownership. Customer-owned code is never overwritten after the first scaffold. Generated data and customer code are deliberately separate.
`;

const messages = (templateId: ThemePresetId) => {
  const labels = {
    harbor: { en: 'Harbor', ar: 'هاربور' },
    manuscript: { en: 'Manuscript', ar: 'المخطوطة' },
    signal: { en: 'Signal', ar: 'سيغنال' },
  } as const;
  return {
    en: {
      themeLabel: labels[templateId].en,
      loading: 'Loading documentation',
      search: 'Search documentation',
      github: 'GitHub',
      documentation: 'Documentation',
      page: 'Page',
      choosePage: 'Choose documentation page',
      onThisPage: 'On this page',
      overview: 'Overview',
      nextSteps: 'Next steps',
      chapters: 'Chapters',
      commandIndex: 'Command index',
      customerOwned: 'Customer-owned component',
      edit: 'Edit',
      syncPreserves: 'Nibleaf sync preserves it',
      noVisiblePages: 'This snapshot has no visible pages.',
    },
    ar: {
      themeLabel: labels[templateId].ar,
      loading: 'جارٍ تحميل التوثيق',
      search: 'ابحث في التوثيق',
      github: 'GitHub',
      documentation: 'التوثيق',
      page: 'الصفحة',
      choosePage: 'اختر صفحة التوثيق',
      onThisPage: 'في هذه الصفحة',
      overview: 'نظرة عامة',
      nextSteps: 'الخطوات التالية',
      chapters: 'الفصول',
      commandIndex: 'فهرس الأوامر',
      customerOwned: 'مكوّن يملكه العميل',
      edit: 'عدّل',
      syncPreserves: 'تحافظ مزامنة Nibleaf عليه',
      noVisiblePages: 'لا تحتوي هذه اللقطة على صفحات ظاهرة.',
    },
  };
};

const inlangSettings = json({
  $schema: 'https://inlang.com/schema/project-settings',
  baseLocale: 'en',
  locales: ['en', 'ar'],
  modules: ['https://cdn.jsdelivr.net/npm/@inlang/plugin-message-format@4/dist/index.js'],
  'plugin.inlang.messageFormat': { pathPattern: './messages/{locale}.json' },
});

const indexHtml = (template: ThemeRepositoryTemplateSource) => `<!doctype html>
<html lang="en"><head><meta charset="UTF-8"/><meta name="viewport" content="width=device-width,initial-scale=1.0"/><meta name="color-scheme" content="light dark"/><link rel="icon" href="/favicon.svg"/><title>Nibleaf ${template.displayName} theme</title></head><body><div id="root"></div><script type="module" src="/src/main.tsx"></script></body></html>
`;

const favicon = (accent: string) =>
  `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64"><rect width="64" height="64" rx="16" fill="${accent}"/><path d="M17 43V21h7l16 13V21h7v22h-7L24 30v13z" fill="#fff"/></svg>\n`;

const customerFiles = (templateId: ThemePresetId, contentPath = 'content'): Array<Omit<ThemeRepositoryFile, 'ownership'>> => {
  const template = THEME_REPOSITORY_TEMPLATE_SOURCES[templateId];
  const localized = messages(templateId);
  return [
    { path: 'package.json', content: packageJson(templateId) },
    { path: 'tsconfig.json', content: tsconfig },
    { path: 'vite.config.ts', content: viteConfig },
    { path: 'index.html', content: indexHtml(template) },
    { path: 'public/favicon.svg', content: favicon(template.accent) },
    { path: '.gitignore', content: 'node_modules\ndist\nsrc/paraglide\n.env\n.env.local\n' },
    { path: '.env.example', content: '# Optional future remote adapter; local snapshots need no secrets.\nVITE_NIBLEAF_API_URL=\n' },
    { path: 'project.inlang/settings.json', content: inlangSettings },
    { path: 'messages/en.json', content: json(localized.en) },
    { path: 'messages/ar.json', content: json(localized.ar) },
    { path: 'src/env.ts', content: envSource },
    { path: 'src/main.tsx', content: mainSource },
    { path: 'src/App.tsx', content: appSource(template, templateId) },
    { path: 'src/nibleaf/runtime.ts', content: runtimeSource },
    { path: 'src/adapters/content.ts', content: adapterSource(contentPath) },
    { path: 'src/adapters/content.test.ts', content: adapterTestSource },
    { path: 'src/theme/theme-utils.ts', content: themeUtilitiesSource },
    { path: `src/theme/${template.componentName}.tsx`, content: template.source },
    { path: `src/theme/${template.componentName}.test.tsx`, content: testSource(template) },
    { path: `src/theme/${templateId}.css`, content: template.style },
  ];
};

const normalizedContentPath = (value = 'content'): string => value.replace(/^\/+|\/+$/g, '');

export const themeRepositoryManifest = (
  snapshot: SiteSnapshot,
  snapshotContent = json(snapshot),
  contentPath = 'content',
  templateId = themeRepositoryTemplateId(snapshot),
): ThemeRepositoryManifestV1 => ({
  kind: THEME_REPOSITORY_KIND,
  schemaVersion: THEME_REPOSITORY_SCHEMA_VERSION,
  project: { id: snapshot.project.id, slug: snapshot.project.slug },
  template: { id: templateId, version: 1 },
  runtime: { strategy: 'vendored', contractVersion: THEME_RUNTIME_CONTRACT_VERSION, entry: 'src/nibleaf/runtime.ts' },
  snapshot: { path: THEME_REPOSITORY_SNAPSHOT_PATH, sha256: sha256(snapshotContent) },
  ownership: {
    platform: ['.nibleaf/**', 'nibleaf.theme.json'],
    shared: [`${normalizedContentPath(contentPath) ? `${normalizedContentPath(contentPath)}/` : ''}**/*.mdx`],
    customer: [
      'src/**',
      'messages/**',
      'project.inlang/**',
      'public/**',
      'README.md',
      'package.json',
      'tsconfig.json',
      'vite.config.ts',
      'index.html',
      '.gitignore',
      '.env.example',
    ],
  },
});

export const buildThemeRepository = (
  snapshot: SiteSnapshot,
  options: { contentPath?: string; template?: ThemePresetId } = {},
): ThemeRepositoryFile[] => {
  const templateId = themeRepositoryTemplateId(snapshot, options.template);
  const normalizedSnapshot = stableSnapshot({
    ...snapshot,
    project: {
      ...snapshot.project,
      config: {
        ...snapshot.project.config,
        theme: { ...record(record(snapshot.project.config)?.theme), preset: templateId },
      },
    },
  });
  const contentMap = themeContentMap(normalizedSnapshot, options.contentPath);
  const snapshotContent = json(normalizedSnapshot);
  const manifest = themeRepositoryManifest(normalizedSnapshot, snapshotContent, options.contentPath, templateId);
  return [
    { path: THEME_REPOSITORY_MANIFEST_PATH, content: json(manifest), ownership: 'PLATFORM' },
    { path: THEME_REPOSITORY_SNAPSHOT_PATH, content: snapshotContent, ownership: 'PLATFORM' },
    { path: THEME_REPOSITORY_CONTENT_MAP_PATH, content: json(contentMap), ownership: 'PLATFORM' },
    { path: '.nibleaf/README.md', content: 'Generated by Nibleaf. Manual changes fail safe import validation.\n', ownership: 'PLATFORM' },
    { path: 'README.md', content: readme(snapshot.project.name, THEME_REPOSITORY_TEMPLATE_SOURCES[templateId], templateId), ownership: 'CUSTOMER' },
    ...customerFiles(templateId, options.contentPath).map((file) => ({ ...file, ownership: 'CUSTOMER' as const })),
  ];
};

export const themeContentPath = (page: SnapshotPage, snapshot: SiteSnapshot, contentPath = 'content'): string => {
  const safeSegment = (value: string): string => {
    const encoded = [...value.trim()]
      .map((character) => (/^[\p{L}\p{N}._-]$/u.test(character) ? character : `~${character.codePointAt(0)?.toString(16)}~`))
      .join('');
    return encoded || 'untitled';
  };
  const version = safeSegment(snapshot.project.versions.find((item) => item.id === page.versionId)?.slug ?? 'main');
  const relative =
    page.path
      .split('/')
      .filter((segment) => segment && segment !== '.' && segment !== '..')
      .map(safeSegment)
      .join('/') || 'index';
  const root = normalizedContentPath(contentPath);
  return `${root ? `${root}/` : ''}${version}/${page.languageCode}/${relative}.mdx`;
};

export const themeContentMap = (snapshot: SiteSnapshot, contentPath = 'content'): Record<string, string> => {
  const byPath = new Map<string, { id: string; path: string }>();
  const entries = snapshot.pages.flatMap((page) => {
    if (page.kind !== 'PAGE') return [];
    const path = themeContentPath(page, snapshot, contentPath);
    const collisionKey = path.toLocaleLowerCase('en-US');
    const existing = byPath.get(collisionKey);
    if (existing) {
      throw new Error(`Pages ${existing.id} and ${page.id} map to the same theme repository path: ${path}.`);
    }
    byPath.set(collisionKey, { id: page.id, path });
    return [[page.id, path] as const];
  });
  return Object.fromEntries(entries);
};

const customerRootFiles = new Set(['README.md', 'package.json', 'tsconfig.json', 'vite.config.ts', 'index.html', '.gitignore', '.env.example']);
const textThemeFile = /\.(?:[cm]?[jt]sx?|css|scss|json|mdx?|html|svg|txt|ya?ml)$/i;

export const themeRepositoryOwnershipForPath = (path: string, contentPath = 'content'): ThemeRepositoryOwnership | null => {
  const normalized = path.replace(/\\/g, '/').replace(/^\/+/, '');
  if (normalized === THEME_REPOSITORY_MANIFEST_PATH || normalized.startsWith('.nibleaf/')) return 'PLATFORM';
  const contentRoot = normalizedContentPath(contentPath);
  if (/\.mdx?$/i.test(normalized) && (!contentRoot || normalized.startsWith(`${contentRoot}/`))) return 'SHARED';
  if (
    customerRootFiles.has(normalized) ||
    ((normalized.startsWith('src/') ||
      normalized.startsWith('messages/') ||
      normalized.startsWith('project.inlang/') ||
      normalized.startsWith('public/')) &&
      textThemeFile.test(normalized))
  ) {
    return 'CUSTOMER';
  }
  return null;
};

export const validateThemeRepositoryImport = (
  files: ReadonlyMap<string, string>,
  expected: SiteSnapshot,
  contentPath = 'content',
  template = themeRepositoryTemplateId(expected),
): ThemeRepositoryImportIssue[] => {
  const manifestText = files.get(THEME_REPOSITORY_MANIFEST_PATH);
  const issues = validateThemeRepositoryManifest(manifestText, expected.project.id, template);
  if (issues.some((issue) => issue.code === 'MANIFEST_INVALID')) return issues;
  const expectedFiles = new Map(
    buildThemeRepository(expected, { contentPath, template })
      .filter((file) => file.ownership === 'PLATFORM')
      .map((file) => [file.path, file.content]),
  );
  for (const [path, content] of expectedFiles) {
    if (files.get(path) !== content) {
      issues.push({ path, code: 'PLATFORM_FILE_MODIFIED', message: `${path} is generated by Nibleaf and cannot be imported as customer code.` });
    }
  }
  for (const path of files.keys()) {
    if (themeRepositoryOwnershipForPath(path, contentPath) === 'PLATFORM' && !expectedFiles.has(path)) {
      issues.push({ path, code: 'PLATFORM_FILE_MODIFIED', message: `${path} is outside the generated Nibleaf platform surface.` });
    }
  }
  return issues;
};
