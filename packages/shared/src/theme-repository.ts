import { createHash } from 'node:crypto';
import { buildNavTree, type NavNode, type SiteSnapshot, type SnapshotLanguage, type SnapshotPage, type SnapshotVersion } from './site';
import { THEME_REPOSITORY_TEMPLATE_META, type ThemeRepositoryTemplateOptions, themeRepositoryTemplateFiles } from './theme-repository-templates';
import { type ResolvedTheme, resolveTheme, THEME_PRESET_IDS, type ThemePresetId, themeOwnedConfig } from './themes';

/**
 * Git-native repository contract v2: the repository Nibleaf pushes/exports is a
 * runnable TanStack Start + Vite + Tailwind docs app. `docs.json` (Mintlify-
 * compatible) carries navigation and theme, `content/**` holds MDX pages, and
 * `.nibleaf/` keeps reconciliation metadata only — no content snapshot blob.
 */
export const THEME_REPOSITORY_SCHEMA_VERSION = 2 as const;
export const THEME_RUNTIME_CONTRACT_VERSION = 2 as const;
export const THEME_REPOSITORY_KIND = 'nibleaf-theme-repository' as const;
export const THEME_REPOSITORY_MANIFEST_PATH = '.nibleaf/manifest.json' as const;
/** Schema v1 manifest location; still recognised so v1 checkouts fail closed with a clear message. */
export const THEME_REPOSITORY_LEGACY_MANIFEST_PATH = 'nibleaf.theme.json' as const;
export const THEME_REPOSITORY_DOCS_CONFIG_PATH = 'docs.json' as const;
export const THEME_REPOSITORY_CONTENT_MAP_PATH = '.nibleaf/content-map.json' as const;
export const THEME_REPOSITORY_VERSIONS_DIRECTORY = 'versions' as const;

export type ThemeRepositoryOwnership = 'PLATFORM' | 'SHARED' | 'CUSTOMER';

export interface ThemeRepositoryFile {
  path: string;
  content: string;
  ownership: ThemeRepositoryOwnership;
}

export interface ThemeRepositoryManifestV2 {
  kind: typeof THEME_REPOSITORY_KIND;
  schemaVersion: typeof THEME_REPOSITORY_SCHEMA_VERSION;
  project: { id: string; slug: string };
  template: { id: ThemePresetId; version: 2 };
  runtime: { strategy: 'docs-json'; contractVersion: typeof THEME_RUNTIME_CONTRACT_VERSION; entry: 'src/lib/site.ts' };
  docs: { path: typeof THEME_REPOSITORY_DOCS_CONFIG_PATH; sha256: string };
  contentMap: { path: typeof THEME_REPOSITORY_CONTENT_MAP_PATH; sha256: string };
  contentPath: string;
  ownership: { platform: readonly string[]; shared: readonly string[]; customer: readonly string[] };
}

export interface ThemeRepositoryImportIssue {
  path: string;
  code: 'MANIFEST_INVALID' | 'PLATFORM_FILE_MODIFIED' | 'UNSUPPORTED_CONTRACT' | 'UNSUPPORTED_TEMPLATE';
  message: string;
}

export interface ThemeContentLocation {
  versionId: string;
  languageCode: string;
  /** Page path segments relative to the language/version directory, without extension. */
  relative: string;
}

const record = (value: unknown): Record<string, unknown> | undefined =>
  typeof value === 'object' && value !== null && !Array.isArray(value) ? (value as Record<string, unknown>) : undefined;

const json = (value: unknown): string => `${JSON.stringify(value, null, 2)}\n`;
const sha256 = (value: string): string => createHash('sha256').update(value).digest('hex');

const normalizedContentPath = (value = 'content'): string => value.replace(/\\/g, '/').replace(/^\/+|\/+$/g, '');

/** Keeps Unicode letters and digits (Arabic slugs stay readable) and encodes
 * everything else so a page path can never escape or alias another file. */
export const safeThemePathSegment = (value: string): string => {
  const encoded = [...value.trim()]
    .map((character) => (/^[\p{L}\p{N}._-]$/u.test(character) ? character : `~${character.codePointAt(0)?.toString(16)}~`))
    .join('');
  return encoded && encoded !== '.' && encoded !== '..' ? encoded : 'untitled';
};

export const themeRepositoryTemplateId = (snapshot: SiteSnapshot, override?: ThemePresetId): ThemePresetId => {
  if (override) return override;
  const configured = record(record(snapshot.project.config)?.theme)?.preset;
  return typeof configured === 'string' && THEME_PRESET_IDS.includes(configured as ThemePresetId) ? (configured as ThemePresetId) : 'harbor';
};

const V1_MESSAGE =
  'This repository uses Nibleaf repository schema v1 (nibleaf.theme.json + .nibleaf/snapshot.json), which is no longer supported. Remove those generated files and push again from Nibleaf to regenerate the docs.json layout (schema v2).';

export const validateThemeRepositoryManifest = (
  manifestText: string | undefined,
  expectedProjectId?: string,
  expectedTemplateId?: ThemePresetId,
): ThemeRepositoryImportIssue[] => {
  const issues: ThemeRepositoryImportIssue[] = [];
  let manifest: Partial<ThemeRepositoryManifestV2> | undefined;
  try {
    manifest = manifestText ? (JSON.parse(manifestText) as Partial<ThemeRepositoryManifestV2>) : undefined;
  } catch {
    manifest = undefined;
  }
  if (manifest?.kind === THEME_REPOSITORY_KIND && (manifest.schemaVersion as number | undefined) === 1) {
    return [{ path: THEME_REPOSITORY_LEGACY_MANIFEST_PATH, code: 'MANIFEST_INVALID', message: V1_MESSAGE }];
  }
  if (!manifest || manifest.kind !== THEME_REPOSITORY_KIND || manifest.schemaVersion !== THEME_REPOSITORY_SCHEMA_VERSION) {
    return [
      {
        path: THEME_REPOSITORY_MANIFEST_PATH,
        code: 'MANIFEST_INVALID',
        message: `Use an unchanged Nibleaf repository manifest v${THEME_REPOSITORY_SCHEMA_VERSION} (${THEME_REPOSITORY_MANIFEST_PATH}).`,
      },
    ];
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
  if (!(typeof templateId === 'string' && THEME_PRESET_IDS.includes(templateId as ThemePresetId)) || manifest.template?.version !== 2) {
    issues.push({
      path: THEME_REPOSITORY_MANIFEST_PATH,
      code: 'UNSUPPORTED_TEMPLATE',
      message: 'This repository must use Harbor, Manuscript, or Signal template contract v2.',
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

const defaultLanguageOf = (snapshot: SiteSnapshot): SnapshotLanguage | undefined =>
  snapshot.project.languages.find((item) => item.isDefault) ?? snapshot.project.languages[0];
const defaultVersionOf = (snapshot: SiteSnapshot): SnapshotVersion | undefined =>
  snapshot.project.versions.find((item) => item.isDefault) ?? snapshot.project.versions[0];

const languageDirectory = (snapshot: SiteSnapshot, languageCode: string): string =>
  languageCode === defaultLanguageOf(snapshot)?.code ? '' : safeThemePathSegment(languageCode);
const versionDirectory = (snapshot: SiteSnapshot, versionId: string): string => {
  if (versionId === defaultVersionOf(snapshot)?.id) return '';
  const version = snapshot.project.versions.find((item) => item.id === versionId);
  return `${THEME_REPOSITORY_VERSIONS_DIRECTORY}/${safeThemePathSegment(version?.slug ?? versionId)}`;
};

/** Directory holding the pages of one version/language: the content root for
 * the defaults, `<root>/<lang>`, `<root>/versions/<slug>`, or `<root>/versions/<slug>/<lang>`. */
export const themeContentDirectory = (snapshot: SiteSnapshot, versionId: string, languageCode: string, contentPath = 'content'): string =>
  [normalizedContentPath(contentPath), versionDirectory(snapshot, versionId), languageDirectory(snapshot, languageCode)].filter(Boolean).join('/');

export const themeContentPath = (page: SnapshotPage, snapshot: SiteSnapshot, contentPath = 'content'): string => {
  const relative =
    page.path
      .split('/')
      .filter((segment) => segment && segment !== '.' && segment !== '..')
      .map(safeThemePathSegment)
      .join('/') || 'index';
  const directory = themeContentDirectory(snapshot, page.versionId, page.languageCode, contentPath);
  return `${directory ? `${directory}/` : ''}${relative}.mdx`;
};

/** Inverse of themeContentPath: which version/language a repository file
 * belongs to. Returns null for files outside the content root or paths that
 * cannot be attributed unambiguously. */
export const themeContentLocation = (path: string, snapshot: SiteSnapshot, contentPath = 'content'): ThemeContentLocation | null => {
  const normalized = path.replace(/\\/g, '/').replace(/^\/+/, '');
  const root = normalizedContentPath(contentPath);
  if (root && !normalized.startsWith(`${root}/`)) return null;
  const inner = root ? normalized.slice(root.length + 1) : normalized;
  if (!/\.mdx?$/i.test(inner)) return null;
  let segments = inner
    .replace(/\.mdx?$/i, '')
    .split('/')
    .filter(Boolean);
  const defaultVersion = defaultVersionOf(snapshot);
  const defaultLanguage = defaultLanguageOf(snapshot);
  let versionId = defaultVersion?.id ?? '';
  let languageCode = defaultLanguage?.code ?? '';
  if (segments[0] === THEME_REPOSITORY_VERSIONS_DIRECTORY && segments.length > 1) {
    const version = snapshot.project.versions.find((item) => item.id !== defaultVersion?.id && safeThemePathSegment(item.slug) === segments[1]);
    if (version) {
      versionId = version.id;
      segments = segments.slice(2);
    }
  }
  const language = snapshot.project.languages.find((item) => item.code !== defaultLanguage?.code && safeThemePathSegment(item.code) === segments[0]);
  if (language) {
    languageCode = language.code;
    segments = segments.slice(1);
  }
  if (segments.length === 0 || !versionId || !languageCode) return null;
  return { versionId, languageCode, relative: segments.join('/') };
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
    const location = themeContentLocation(path, snapshot, contentPath);
    if (!location || location.versionId !== page.versionId || location.languageCode !== page.languageCode) {
      throw new Error(
        `Page ${page.id} (${page.path}) maps to ${path}, which reads back as a different language or version. Rename the page so its path does not start with a language code or "${THEME_REPOSITORY_VERSIONS_DIRECTORY}".`,
      );
    }
    byPath.set(collisionKey, { id: page.id, path });
    return [[page.id, path] as const];
  });
  return Object.fromEntries(entries);
};

const repositoryLanguages = (snapshot: SiteSnapshot): SnapshotLanguage[] => {
  const defaultLanguage = defaultLanguageOf(snapshot);
  return [...snapshot.project.languages].sort((a, b) => Number(b.code === defaultLanguage?.code) - Number(a.code === defaultLanguage?.code));
};
const repositoryVersions = (snapshot: SiteSnapshot): SnapshotVersion[] => {
  const defaultVersion = defaultVersionOf(snapshot);
  return [...snapshot.project.versions].sort((a, b) => Number(b.id === defaultVersion?.id) - Number(a.id === defaultVersion?.id));
};

const resolvedRepositoryTheme = (snapshot: SiteSnapshot, templateId: ThemePresetId): ResolvedTheme => {
  const owned = themeOwnedConfig(record(snapshot.project.config));
  return resolveTheme({ ...owned, theme: { ...owned.theme, preset: templateId } });
};

const repositoryAppearance = (snapshot: SiteSnapshot): 'light' | 'dark' | 'system' => {
  const configured = record(record(snapshot.project.config)?.styling)?.theme;
  return configured === 'dark' || configured === 'system' ? configured : 'light';
};

type DocsNavEntry = string | { group: string; icon?: string; pages: DocsNavEntry[] };

/** Page entries are content-root-relative paths without `.mdx`, exactly what
 * `src/lib/site.ts` keys its page map by. */
const contentKey = (page: SnapshotPage, snapshot: SiteSnapshot, contentPath: string): string => {
  const path = themeContentPath(page, snapshot, contentPath);
  const root = normalizedContentPath(contentPath);
  return (root ? path.slice(root.length + 1) : path).replace(/\.mdx$/, '');
};

const docsNavigationPages = (nodes: NavNode[], pageById: Map<string, SnapshotPage>, snapshot: SiteSnapshot, contentPath: string): DocsNavEntry[] =>
  nodes.flatMap((node): DocsNavEntry[] => {
    if (node.kind === 'GROUP') {
      const pages = docsNavigationPages(node.children, pageById, snapshot, contentPath);
      return [{ group: node.title, ...(node.icon ? { icon: node.icon } : {}), pages }];
    }
    const page = pageById.get(node.id);
    return page ? [contentKey(page, snapshot, contentPath)] : [];
  });

/** Mintlify-compatible `docs.json` plus an `x-nibleaf` block with everything
 * the generated app needs (resolved theme, languages with direction, versions). */
export const themeRepositoryDocsConfig = (
  snapshot: SiteSnapshot,
  contentPath = 'content',
  templateId = themeRepositoryTemplateId(snapshot),
): Record<string, unknown> => {
  const theme = resolvedRepositoryTheme(snapshot, templateId);
  const languages = repositoryLanguages(snapshot);
  const versions = repositoryVersions(snapshot);
  const defaultLanguage = defaultLanguageOf(snapshot);
  const defaultVersion = defaultVersionOf(snapshot);
  const pageById = new Map(snapshot.pages.map((page) => [page.id, page]));
  const languageNavigation = (version: SnapshotVersion) =>
    languages.map((language) => ({
      language: language.code,
      'x-nibleaf': { label: language.label, direction: language.direction, default: language.code === defaultLanguage?.code },
      pages: docsNavigationPages(
        buildNavTree(
          snapshot.pages.filter((page) => page.versionId === version.id),
          language.code,
        ),
        pageById,
        snapshot,
        contentPath,
      ),
    }));
  const navigation =
    versions.length > 1
      ? {
          versions: versions.map((version) => ({
            version: version.name,
            'x-nibleaf': { slug: version.slug, default: version.id === defaultVersion?.id },
            languages: languageNavigation(version),
          })),
        }
      : { languages: versions[0] ? languageNavigation(versions[0]) : [] };
  return {
    $schema: 'https://mintlify.com/docs.json',
    name: snapshot.project.name,
    ...(snapshot.project.description ? { description: snapshot.project.description } : {}),
    colors: { primary: theme.colors.light.accent, light: theme.colors.dark.accent, dark: theme.colors.light.accent },
    navigation,
    'x-nibleaf': {
      project: { id: snapshot.project.id, slug: snapshot.project.slug },
      template: { id: templateId, version: 2 },
      theme,
      appearance: repositoryAppearance(snapshot),
      languages: languages.map((language) => ({
        code: language.code,
        label: language.label,
        direction: language.direction,
        isDefault: language.code === defaultLanguage?.code,
        enabled: language.enabled !== false,
        directory: languageDirectory(snapshot, language.code),
      })),
      versions: versions.map((version) => ({
        id: version.id,
        name: version.name,
        slug: version.slug,
        isDefault: version.id === defaultVersion?.id,
        directory: versionDirectory(snapshot, version.id),
      })),
      contentPath: normalizedContentPath(contentPath),
    },
  };
};

const CUSTOMER_ROOT_FILES = ['README.md', 'package.json', 'tsconfig.json', 'vite.config.ts', 'vitest.config.ts', '.gitignore'] as const;
const customerRootFiles = new Set<string>(CUSTOMER_ROOT_FILES);
const textThemeFile = /\.(?:[cm]?[jt]sx?|css|scss|json|mdx?|html|svg|txt|ya?ml)$/i;

export const themeRepositoryManifest = (
  snapshot: SiteSnapshot,
  options: { docsContent: string; contentMapContent: string; contentPath?: string; templateId?: ThemePresetId },
): ThemeRepositoryManifestV2 => {
  const root = normalizedContentPath(options.contentPath);
  return {
    kind: THEME_REPOSITORY_KIND,
    schemaVersion: THEME_REPOSITORY_SCHEMA_VERSION,
    project: { id: snapshot.project.id, slug: snapshot.project.slug },
    template: { id: options.templateId ?? themeRepositoryTemplateId(snapshot), version: 2 },
    runtime: { strategy: 'docs-json', contractVersion: THEME_RUNTIME_CONTRACT_VERSION, entry: 'src/lib/site.ts' },
    docs: { path: THEME_REPOSITORY_DOCS_CONFIG_PATH, sha256: sha256(options.docsContent) },
    contentMap: { path: THEME_REPOSITORY_CONTENT_MAP_PATH, sha256: sha256(options.contentMapContent) },
    contentPath: root,
    ownership: {
      platform: ['.nibleaf/**', THEME_REPOSITORY_DOCS_CONFIG_PATH],
      shared: [`${root ? `${root}/` : ''}**/*.mdx`],
      customer: ['src/**', 'messages/**', 'project.inlang/**', 'public/**', ...CUSTOMER_ROOT_FILES],
    },
  };
};

export const buildThemeRepository = (
  snapshot: SiteSnapshot,
  options: { contentPath?: string; template?: ThemePresetId } = {},
): ThemeRepositoryFile[] => {
  const templateId = themeRepositoryTemplateId(snapshot, options.template);
  const contentMapContent = json(themeContentMap(snapshot, options.contentPath));
  const docsContent = json(themeRepositoryDocsConfig(snapshot, options.contentPath, templateId));
  const manifest = themeRepositoryManifest(snapshot, { docsContent, contentMapContent, contentPath: options.contentPath, templateId });
  const defaultLanguage = defaultLanguageOf(snapshot);
  const templateOptions: ThemeRepositoryTemplateOptions = {
    templateId,
    displayName: THEME_REPOSITORY_TEMPLATE_META[templateId].displayName,
    projectName: snapshot.project.name,
    projectDescription: snapshot.project.description,
    contentRoot: normalizedContentPath(options.contentPath),
    languages: repositoryLanguages(snapshot).map((language) => ({
      code: language.code,
      label: language.label,
      direction: language.direction,
      isDefault: language.code === defaultLanguage?.code,
    })),
    theme: resolvedRepositoryTheme(snapshot, templateId),
    appearance: repositoryAppearance(snapshot),
  };
  return [
    { path: THEME_REPOSITORY_MANIFEST_PATH, content: json(manifest), ownership: 'PLATFORM' },
    { path: THEME_REPOSITORY_DOCS_CONFIG_PATH, content: docsContent, ownership: 'PLATFORM' },
    { path: THEME_REPOSITORY_CONTENT_MAP_PATH, content: contentMapContent, ownership: 'PLATFORM' },
    ...themeRepositoryTemplateFiles(templateOptions).map((file) => ({ ...file, ownership: 'CUSTOMER' as const })),
  ];
};

export const themeRepositoryOwnershipForPath = (path: string, contentPath = 'content'): ThemeRepositoryOwnership | null => {
  const normalized = path.replace(/\\/g, '/').replace(/^\/+/, '');
  if (
    normalized === THEME_REPOSITORY_LEGACY_MANIFEST_PATH ||
    normalized === THEME_REPOSITORY_DOCS_CONFIG_PATH ||
    normalized.startsWith('.nibleaf/')
  ) {
    return 'PLATFORM';
  }
  if (customerRootFiles.has(normalized)) return 'CUSTOMER';
  const contentRoot = normalizedContentPath(contentPath);
  if (/\.mdx?$/i.test(normalized) && (!contentRoot || normalized.startsWith(`${contentRoot}/`))) return 'SHARED';
  if (
    (normalized.startsWith('src/') ||
      normalized.startsWith('messages/') ||
      normalized.startsWith('project.inlang/') ||
      normalized.startsWith('public/')) &&
    textThemeFile.test(normalized)
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
  const manifestText = files.get(THEME_REPOSITORY_MANIFEST_PATH) ?? files.get(THEME_REPOSITORY_LEGACY_MANIFEST_PATH);
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
