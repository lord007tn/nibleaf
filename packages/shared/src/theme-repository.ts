import { createHash } from 'node:crypto';
import type { SiteSnapshot, SnapshotPage } from './site';

export const THEME_REPOSITORY_SCHEMA_VERSION = 1 as const;
export const THEME_RUNTIME_CONTRACT_VERSION = 1 as const;
export const THEME_REPOSITORY_KIND = 'nibleaf-theme-repository' as const;
export const THEME_REPOSITORY_MANIFEST_PATH = 'nibleaf.theme.json' as const;
export const THEME_REPOSITORY_SNAPSHOT_PATH = '.nibleaf/snapshot.json' as const;

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
  template: { id: 'harbor'; version: 1 };
  runtime: { strategy: 'vendored'; contractVersion: typeof THEME_RUNTIME_CONTRACT_VERSION; entry: 'src/nibleaf/runtime.ts' };
  snapshot: { path: typeof THEME_REPOSITORY_SNAPSHOT_PATH; sha256: string };
  ownership: {
    platform: readonly string[];
    shared: readonly string[];
    customer: readonly string[];
  };
}

export interface ThemeRepositoryImportIssue {
  path: string;
  code: 'MANIFEST_INVALID' | 'PLATFORM_FILE_MODIFIED' | 'UNSUPPORTED_CONTRACT' | 'UNSUPPORTED_TEMPLATE';
  message: string;
}

export const validateThemeRepositoryManifest = (manifestText: string | undefined, expectedProjectId?: string): ThemeRepositoryImportIssue[] => {
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
  if (manifest.template?.id !== 'harbor' || manifest.template.version !== 1) {
    issues.push({ path: THEME_REPOSITORY_MANIFEST_PATH, code: 'UNSUPPORTED_TEMPLATE', message: 'This slice accepts the Harbor v1 template only.' });
  }
  return issues;
};

const json = (value: unknown): string => `${JSON.stringify(value, null, 2)}\n`;
const sha256 = (value: string): string => createHash('sha256').update(value).digest('hex');
const stableSnapshot = (snapshot: SiteSnapshot): SiteSnapshot => ({
  ...snapshot,
  // Draft snapshot assembly uses wall-clock time. A Git operation must not
  // create a new generated-file diff when project data is otherwise unchanged.
  generatedAt:
    snapshot.pages
      .map((page) => page.updatedAt)
      .sort()
      .at(-1) ?? '1970-01-01T00:00:00.000Z',
});

const packageJson = json({
  name: 'nibleaf-harbor-theme',
  private: true,
  version: '0.1.0',
  type: 'module',
  engines: { node: '>=22.13.0', pnpm: '>=10.0.0' },
  packageManager: 'pnpm@10.30.3',
  scripts: {
    dev: 'paraglide-js compile --project ./project.inlang --outdir ./src/paraglide && vite',
    build: 'paraglide-js compile --project ./project.inlang --outdir ./src/paraglide && tsc --noEmit && vite build',
    test: 'vitest run',
    check: 'vitest run && paraglide-js compile --project ./project.inlang --outdir ./src/paraglide && tsc --noEmit && vite build',
  },
  dependencies: {
    '@t3-oss/env-core': '^0.13.11',
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
    allowJs: false,
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
    types: ['vite/client'],
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

const adapterSource = `import { env } from '../env';
import { loadSnapshot, type SiteSnapshot } from '../nibleaf/runtime';

export interface ContentAdapter { load(): Promise<SiteSnapshot> }

/** Local development never needs production secrets. Replace this adapter to
 * opt into a versioned Nibleaf API once an official remote SDK is available. */
export const contentAdapter: ContentAdapter = {
  async load() {
    void env.VITE_NIBLEAF_API_URL;
    return loadSnapshot();
  },
};
`;

const appSource = `import { useEffect, useState } from 'react';
import { contentAdapter } from './adapters/content';
import type { SiteSnapshot } from './nibleaf/runtime';
import { HarborTheme } from './theme/HarborTheme';
import './theme/theme.css';

export function App() {
  const [snapshot, setSnapshot] = useState<SiteSnapshot>();
  useEffect(() => { void contentAdapter.load().then(setSnapshot); }, []);
  return snapshot ? <HarborTheme snapshot={snapshot} /> : <p className="loading">Loading documentation…</p>;
}
`;

const mainSource = `import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './App';

createRoot(document.getElementById('root')!).render(<StrictMode><App /></StrictMode>);
`;

const harborSource = `import { useMemo, useState } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import type { SitePage, SiteSnapshot } from '../nibleaf/runtime';

export function HarborTheme({ snapshot }: { snapshot: SiteSnapshot }) {
  const visiblePages = useMemo(() => snapshot.pages.filter((page) => page.kind === 'PAGE' && !page.hidden), [snapshot.pages]);
  const [activeId, setActiveId] = useState(visiblePages[0]?.id);
  const page = visiblePages.find((item) => item.id === activeId) ?? visiblePages[0];
  const language = snapshot.project.languages.find((item) => item.code === page?.languageCode) ?? snapshot.project.languages[0];
  if (!page || !language) return <main className="empty">This snapshot has no visible pages.</main>;
  return (
    <div className="harbor" dir={language.direction === 'RTL' ? 'rtl' : 'ltr'}>
      <header className="topbar">
        <a className="brand" href="/">{snapshot.project.name}<span>Harbor</span></a>
        <div className="search" aria-label="Search documentation">⌕ Search documentation</div>
        <a className="github" href="https://github.com" rel="noreferrer">GitHub ↗</a>
      </header>
      <aside className="sidebar">
        <p className="eyebrow">Documentation</p>
        <nav>{visiblePages.map((item) => <PageLink active={item.id === page.id} key={item.id} onSelect={() => setActiveId(item.id)} page={item} />)}</nav>
        <div className="extension"><strong>Customer-owned component</strong><p>Edit <code>src/theme/HarborTheme.tsx</code>; Nibleaf sync will preserve it.</p></div>
      </aside>
      <main className="article">
        <p className="eyebrow">{language.label} · {snapshot.project.versions.find((item) => item.id === page.versionId)?.name}</p>
        <h1>{page.title}</h1>
        {page.description ? <p className="lede">{page.description}</p> : null}
        <article className="prose"><ReactMarkdown remarkPlugins={[remarkGfm]}>{page.content}</ReactMarkdown></article>
      </main>
      <aside className="toc"><p className="eyebrow">On this page</p><a href="#overview">Overview</a><a href="#next-steps">Next steps</a></aside>
    </div>
  );
}

function PageLink({ active, onSelect, page }: { active: boolean; onSelect(): void; page: SitePage }) {
  return <button className={active ? 'nav-link active' : 'nav-link'} onClick={onSelect} type="button">{page.title}</button>;
}
`;

const cssSource = `:root{font-family:Inter,ui-sans-serif,system-ui,sans-serif;color:#182132;background:#fbfcfe;font-synthesis:none}*{box-sizing:border-box}body{margin:0}.harbor{display:grid;grid-template-columns:17rem minmax(0,1fr) 13rem;grid-template-rows:4.25rem minmax(calc(100vh - 4.25rem),auto);grid-template-areas:"top top top" "side article toc"}.topbar{grid-area:top;position:sticky;top:0;z-index:4;display:flex;align-items:center;gap:2rem;padding:0 2rem;border-bottom:1px solid #dce3ec;background:rgba(251,252,254,.92);backdrop-filter:blur(14px)}.brand{font-weight:760;color:#142038;text-decoration:none;font-size:1.05rem}.brand span{margin-inline-start:.65rem;border-radius:999px;background:#e7f7f3;color:#087866;padding:.22rem .55rem;font-size:.68rem;letter-spacing:.08em;text-transform:uppercase}.search{margin-inline:auto;width:min(28rem,40vw);padding:.68rem 1rem;border:1px solid #d8e0e9;border-radius:.7rem;background:#fff;color:#718096;font-size:.86rem;box-shadow:0 1px 2px rgba(30,45,68,.04)}.github{color:#31506f;text-decoration:none;font-size:.86rem}.sidebar{grid-area:side;padding:2rem 1.4rem;border-inline-end:1px solid #e2e8f0;background:#f7f9fc}.eyebrow{margin:0 0 .9rem;color:#75859a;font-size:.72rem;font-weight:700;letter-spacing:.11em;text-transform:uppercase}.nav-link{display:block;width:100%;margin:.18rem 0;padding:.68rem .8rem;border:0;border-radius:.55rem;background:transparent;color:#52647b;text-align:start;cursor:pointer}.nav-link:hover,.nav-link.active{background:#e5f5f1;color:#087866;font-weight:650}.extension{margin-top:2rem;padding:1rem;border:1px solid #cfe3df;border-radius:.75rem;background:#effaf7;font-size:.75rem;line-height:1.5;color:#385d58}.extension p{margin:.4rem 0 0}.article{grid-area:article;width:min(100%,52rem);padding:4rem 4.5rem 6rem}.article h1{margin:.25rem 0 .8rem;color:#111b2d;font-size:clamp(2.2rem,5vw,3.8rem);line-height:1.04;letter-spacing:-.045em}.lede{max-width:44rem;color:#617188;font-size:1.18rem;line-height:1.7}.prose{margin-top:2.8rem;color:#33445b;font-size:1rem;line-height:1.8}.prose h2{margin-top:2.6rem;color:#17243a;font-size:1.5rem}.prose code{padding:.15rem .35rem;border-radius:.3rem;background:#edf2f7;color:#087866}.prose pre{overflow:auto;padding:1.1rem;border-radius:.8rem;background:#101827;color:#dbeafe}.toc{grid-area:toc;padding:4rem 1.2rem}.toc a{display:block;margin:.65rem 0;color:#6a7b91;text-decoration:none;font-size:.82rem}.loading,.empty{padding:3rem}@media(max-width:900px){.harbor{grid-template-columns:1fr;grid-template-areas:"top" "article";grid-template-rows:4rem auto}.topbar{padding:0 1rem}.search,.github,.sidebar,.toc{display:none}.article{padding:2.5rem 1.25rem}.article h1{font-size:2.35rem}}
`;

const testSource = `import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { loadSnapshot } from '../nibleaf/runtime';
import { HarborTheme } from './HarborTheme';

describe('Harbor theme', () => {
  it('renders fixture content through the vendored runtime contract', () => {
    const html = renderToStaticMarkup(<HarborTheme snapshot={loadSnapshot()} />);
    expect(html).toContain('Customer-owned component');
    expect(html).toContain(loadSnapshot().project.name);
  });
});
`;

const readme = (projectName: string) => `# ${projectName} documentation theme

This is a normal, self-contained Vite 8 + React repository exported by Nibleaf. It uses React Compiler, TypeScript 7, ParaglideJS, typed t3-env validation, and a vendored Nibleaf runtime contract. It does not need production secrets or a Nibleaf monorepo checkout.

## One-command local setup

\`corepack pnpm install && corepack pnpm dev\`

Then open the URL printed by Vite. Run \`corepack pnpm check\` before pushing.

## Extension points and ownership

- Edit \`src/theme/HarborTheme.tsx\` and \`src/theme/theme.css\` for layout and presentation.
- Replace or wrap \`src/adapters/content.ts\` to change how data is loaded.
- Put static assets in \`public/\`.
- Edit documentation MDX under \`content/\`; Nibleaf and Git reconcile it with the recorded common base.
- Do not hand-edit \`.nibleaf/\` or \`nibleaf.theme.json\`. Nibleaf regenerates and verifies those files.

The manifest is the source of truth for ownership. Customer-owned code is never overwritten after the first scaffold. Generated data and customer code are deliberately separate.
`;

const inlangSettings = json({
  $schema: 'https://inlang.com/schema/project-settings',
  baseLocale: 'en',
  locales: ['en', 'ar'],
  modules: ['https://cdn.jsdelivr.net/npm/@inlang/plugin-message-format@4/dist/index.js'],
  'plugin.inlang.messageFormat': { pathPattern: './messages/{locale}.json' },
});

const indexHtml = `<!doctype html>
<html lang="en"><head><meta charset="UTF-8"/><meta name="viewport" content="width=device-width,initial-scale=1.0"/><meta name="color-scheme" content="light"/><link rel="icon" href="/favicon.svg"/><title>Nibleaf Harbor theme</title></head><body><div id="root"></div><script type="module" src="/src/main.tsx"></script></body></html>
`;

const favicon = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64"><rect width="64" height="64" rx="16" fill="#087866"/><path d="M17 43V21h7l16 13V21h7v22h-7L24 30v13z" fill="#fff"/></svg>\n`;

const staticCustomerFiles: ReadonlyArray<Omit<ThemeRepositoryFile, 'ownership'>> = [
  { path: 'package.json', content: packageJson },
  { path: 'tsconfig.json', content: tsconfig },
  { path: 'vite.config.ts', content: viteConfig },
  { path: 'index.html', content: indexHtml },
  { path: 'public/favicon.svg', content: favicon },
  { path: '.gitignore', content: 'node_modules\ndist\nsrc/paraglide\n.env\n.env.local\n' },
  { path: '.env.example', content: '# Optional future remote adapter; local snapshots need no secrets.\nVITE_NIBLEAF_API_URL=\n' },
  { path: 'project.inlang/settings.json', content: inlangSettings },
  { path: 'messages/en.json', content: json({ search: 'Search documentation', onThisPage: 'On this page' }) },
  { path: 'messages/ar.json', content: json({ search: 'ابحث في التوثيق', onThisPage: 'في هذه الصفحة' }) },
  { path: 'src/env.ts', content: envSource },
  { path: 'src/main.tsx', content: mainSource },
  { path: 'src/App.tsx', content: appSource },
  { path: 'src/nibleaf/runtime.ts', content: runtimeSource },
  { path: 'src/adapters/content.ts', content: adapterSource },
  { path: 'src/theme/HarborTheme.tsx', content: harborSource },
  { path: 'src/theme/HarborTheme.test.tsx', content: testSource },
  { path: 'src/theme/theme.css', content: cssSource },
];

const normalizedContentPath = (value = 'content'): string => value.replace(/^\/+|\/+$/g, '');

export const themeRepositoryManifest = (
  snapshot: SiteSnapshot,
  snapshotContent = json(snapshot),
  contentPath = 'content',
): ThemeRepositoryManifestV1 => ({
  kind: THEME_REPOSITORY_KIND,
  schemaVersion: THEME_REPOSITORY_SCHEMA_VERSION,
  project: { id: snapshot.project.id, slug: snapshot.project.slug },
  template: { id: 'harbor', version: 1 },
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

export const buildThemeRepository = (snapshot: SiteSnapshot, options: { contentPath?: string } = {}): ThemeRepositoryFile[] => {
  const normalizedSnapshot = stableSnapshot(snapshot);
  const snapshotContent = json(normalizedSnapshot);
  const manifest = themeRepositoryManifest(normalizedSnapshot, snapshotContent, options.contentPath);
  return [
    { path: THEME_REPOSITORY_MANIFEST_PATH, content: json(manifest), ownership: 'PLATFORM' },
    { path: THEME_REPOSITORY_SNAPSHOT_PATH, content: snapshotContent, ownership: 'PLATFORM' },
    { path: '.nibleaf/README.md', content: 'Generated by Nibleaf. Manual changes fail safe import validation.\n', ownership: 'PLATFORM' },
    { path: 'README.md', content: readme(snapshot.project.name), ownership: 'CUSTOMER' },
    ...staticCustomerFiles.map((file) => ({ ...file, ownership: 'CUSTOMER' as const })),
  ];
};

export const themeContentPath = (page: SnapshotPage, snapshot: SiteSnapshot, contentPath = 'content'): string => {
  const safeSegment = (value: string): string =>
    value
      .replace(/\.\.+/g, '.')
      .replace(/[\\<>:"|?*]/g, '-')
      .replace(/\p{Cc}/gu, '-')
      .trim() || 'untitled';
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

const customerRootFiles = new Set(staticCustomerFiles.map((file) => file.path).concat('README.md'));
const textThemeFile = /\.(?:[cm]?[jt]sx?|css|scss|json|mdx?|html|svg|txt|ya?ml)$/i;

/** Classify only files inside the declared sync surface. Unknown repository
 * files are left alone and never fetched or mutated by Nibleaf. */
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

export const validateThemeRepositoryImport = (files: ReadonlyMap<string, string>, expected: SiteSnapshot): ThemeRepositoryImportIssue[] => {
  const manifestText = files.get(THEME_REPOSITORY_MANIFEST_PATH);
  const issues = validateThemeRepositoryManifest(manifestText, expected.project.id);
  if (issues.some((issue) => issue.code === 'MANIFEST_INVALID')) return issues;
  const expectedFiles = new Map(
    buildThemeRepository(expected)
      .filter((file) => file.ownership === 'PLATFORM')
      .map((file) => [file.path, file.content]),
  );
  for (const [path, content] of expectedFiles) {
    if (files.get(path) !== content) {
      issues.push({ path, code: 'PLATFORM_FILE_MODIFIED', message: `${path} is generated by Nibleaf and cannot be imported as customer code.` });
    }
  }
  return issues;
};
