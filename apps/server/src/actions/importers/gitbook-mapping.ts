import { posix } from 'node:path';
import { slugify } from '@nibleaf/shared';
import { closesMarkdownFence, type MarkdownFence, openingMarkdownFence } from '@nibleaf/shared/markdown-code';
import { parse as parseYaml } from 'yaml';
import { humanize, stableHash } from './content';
import { safeDecodeUri } from './gitbook-markdown';

/**
 * GitBook Git Sync repository layout → an ordered page plan. Pure (no prisma /
 * fetch / `@/…` imports) so the mapping is unit-testable.
 *
 * A space is described by `.gitbook.yaml` (`root`, `structure.readme`,
 * `structure.summary`, `redirects`); its table of contents is `SUMMARY.md`,
 * where headings start sections and nested list items are child pages. Without
 * a SUMMARY.md, GitBook infers navigation from folders — so do we.
 */

export interface GitBookSpaceConfig {
  /** Repo path of `.gitbook.yaml`, when the repo has one. */
  configPath?: string;
  /** Repo directory all space paths are relative to ('' = repo root). */
  root: string;
  /** Root-relative path of the first page. */
  readme: string;
  /** Root-relative path of the table of contents. */
  summary: string;
  /** `from` URL path → root-relative destination file. */
  redirects: Array<{ from: string; to: string }>;
}

export type GitBookNavNode =
  | { kind: 'page'; path: string; title: string; label?: string; children: GitBookNavNode[] }
  | { kind: 'group'; title: string; children: GitBookNavNode[] };

export interface GitBookSection {
  /** Section heading from SUMMARY.md; undefined for pages listed before any heading. */
  title?: string;
  nodes: GitBookNavNode[];
}

const CONFIG_NAMES = new Set(['.gitbook.yaml', '.gitbook.yml']);
const depth = (path: string) => path.split('/').length;
const directoryOf = (path: string) => (posix.dirname(path) === '.' ? '' : posix.dirname(path));
const isMarkdown = (path: string) => /\.md$/i.test(path);
const withoutExtension = (path: string) => path.replace(/\.md$/i, '');

/** Join inside the repository; undefined when the result escapes it. */
const joinInside = (...parts: string[]): string | undefined => {
  const joined = posix.normalize(posix.join('.', ...parts)).replace(/\/+$/, '');
  if (joined === '.') return '';
  return joined.startsWith('../') || joined === '..' ? undefined : joined;
};

/**
 * Locate the space: `.gitbook.yaml` inside the requested directory (or the
 * repo root, else the shallowest one), falling back to the shallowest
 * SUMMARY.md, then to the repo root itself.
 */
export const findGitBookSpace = (paths: readonly string[], directory = ''): { configPath?: string; directory: string } | undefined => {
  const base = joinInside(directory);
  if (base === undefined) return undefined;
  const inside = (path: string) => !base || path.startsWith(`${base}/`);
  const configs = paths.filter((path) => CONFIG_NAMES.has(posix.basename(path)) && inside(path)).sort((a, b) => depth(a) - depth(b));
  const exact = configs.find((path) => directoryOf(path) === base);
  const config = exact ?? configs[0];
  if (config) return { configPath: config, directory: directoryOf(config) };
  const summaries = paths.filter((path) => posix.basename(path) === 'SUMMARY.md' && inside(path)).sort((a, b) => depth(a) - depth(b));
  return { directory: summaries[0] ? directoryOf(summaries[0]) : base };
};

/** Parse `.gitbook.yaml`; invalid or escaping values fall back to defaults with a warning. */
export const parseGitBookConfig = (
  raw: string | null,
  configPath: string | undefined,
  directory: string,
): { config: GitBookSpaceConfig; warnings: string[] } => {
  const warnings: string[] = [];
  let data: Record<string, unknown> = {};
  if (raw !== null && configPath) {
    try {
      const parsed = parseYaml(raw);
      if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) data = parsed as Record<string, unknown>;
    } catch {
      warnings.push(`${configPath} is not valid YAML — GitBook defaults were used.`);
    }
  }
  const string = (value: unknown) => (typeof value === 'string' && value.trim() ? value.trim() : undefined);
  let root = joinInside(directory, string(data.root) ?? './');
  if (root === undefined) {
    warnings.push(`${configPath ?? '.gitbook.yaml'} sets a root outside the repository — the configuration directory was used.`);
    root = directory;
  }
  const structure = data.structure && typeof data.structure === 'object' ? (data.structure as Record<string, unknown>) : {};
  const relative = (value: string | undefined, fallback: string) => {
    const path = value ? joinInside(value) : fallback;
    if (path !== undefined && path !== '') return path;
    warnings.push(`${configPath ?? '.gitbook.yaml'} sets a structure path "${value}" outside the space root — "${fallback}" was used.`);
    return fallback;
  };
  const redirects: GitBookSpaceConfig['redirects'] = [];
  if (data.redirects && typeof data.redirects === 'object' && !Array.isArray(data.redirects)) {
    for (const [from, to] of Object.entries(data.redirects as Record<string, unknown>)) {
      if (typeof to === 'string' && from.trim()) redirects.push({ from: from.trim(), to: to.trim() });
    }
  }
  return {
    config: {
      ...(configPath ? { configPath } : {}),
      root,
      readme: relative(string(structure.readme), 'README.md'),
      summary: relative(string(structure.summary), 'SUMMARY.md'),
      redirects,
    },
    warnings,
  };
};

const plainText = (value: string): string =>
  value
    .replace(/<[^>]*>/g, '')
    .replace(/[*_`~]/g, '')
    .replace(/\\(.)/g, '$1')
    .trim();

const LIST_ITEM = /^(\s*)[*+-]\s+\[((?:\\.|[^\]\\])*)\]\((.*)\)\s*$/;

/** Split a link destination into target and optional `"Navigation label"`. */
const linkDestination = (destination: string): { target: string; label?: string } => {
  const trimmed = destination.trim();
  const match = trimmed.match(/^<([^>]+)>(?:\s+(?:"([^"]*)"|'([^']*)'))?$/) ?? trimmed.match(/^(\S+)(?:\s+(?:"([^"]*)"|'([^']*)'))?$/);
  if (!match?.[1]) return { target: trimmed };
  const label = match[2] ?? match[3];
  return { target: match[1], ...(label ? { label } : {}) };
};

/** SUMMARY.md → sections of nested pages. Link targets resolve relative to
 * the summary file and are returned root-relative. */
export const parseGitBookSummary = (markdown: string, summaryPath = 'SUMMARY.md'): { sections: GitBookSection[]; warnings: string[] } => {
  const warnings: string[] = [];
  const sections: GitBookSection[] = [{ nodes: [] }];
  const seen = new Set<string>();
  const summaryDirectory = directoryOf(summaryPath);
  let stack: Array<{ indent: number; children: GitBookNavNode[] }> = [];
  let sawContent = false;
  let fence: MarkdownFence | undefined;

  for (const line of markdown.replace(/\r\n/g, '\n').split('\n')) {
    if (fence) {
      if (closesMarkdownFence(line, fence, Number.POSITIVE_INFINITY)) fence = undefined;
      continue;
    }
    fence = openingMarkdownFence(line, Number.POSITIVE_INFINITY);
    if (fence || !line.trim()) continue;
    const heading = line.match(/^(#{1,6})\s+(.+?)\s*#*\s*$/);
    if (heading) {
      // The leading `# Summary` / `# Table of contents` is the file's own title.
      if (!sawContent && heading[1] === '#') {
        sawContent = true;
        continue;
      }
      sawContent = true;
      const title = plainText(heading[2] ?? '');
      if (title) sections.push({ title, nodes: [] });
      stack = [];
      continue;
    }
    const item = line.match(LIST_ITEM);
    if (!item) continue;
    sawContent = true;
    const indent = (item[1] ?? '').replace(/\t/g, '    ').length;
    const title = plainText(item[2] ?? '') || 'Untitled';
    const { target, label } = linkDestination(item[3] ?? '');
    while (stack.length > 0 && (stack.at(-1)?.indent ?? -1) >= indent) stack.pop();
    const siblings = stack.at(-1)?.children ?? sections.at(-1)?.nodes ?? [];

    if (/^(?:[a-z][a-z0-9+.-]*:|\/\/)/i.test(target)) {
      warnings.push(`SUMMARY.md links to the external URL "${target}" — external navigation links are not imported.`);
      continue;
    }
    const path = joinInside(summaryDirectory, safeDecodeUri(target.split('#', 1)[0] ?? target));
    if (!path || !isMarkdown(path)) {
      warnings.push(`SUMMARY.md entry "${title}" does not point to a Markdown page and was skipped.`);
      continue;
    }
    if (seen.has(path) && target.includes('#')) {
      warnings.push(`SUMMARY.md shortcut "${title}" links to a section of "${path}" — section shortcuts are not imported as sidebar entries.`);
      continue;
    }
    if (seen.has(path)) {
      warnings.push(`SUMMARY.md lists "${path}" more than once — only the first entry was imported.`);
      continue;
    }
    seen.add(path);
    const node: GitBookNavNode = { kind: 'page', path, title, ...(label ? { label } : {}), children: [] };
    siblings.push(node);
    stack.push({ indent, children: node.children });
  }
  return { sections: sections.filter((section) => section.nodes.length > 0), warnings };
};

const IGNORED_SEGMENT = /^(?:\.|_|node_modules$)/;

/** No SUMMARY.md: folders become pages (their README) or groups, files sorted by name. */
export const inferGitBookNavigation = (paths: readonly string[], root: string, readme: string, summary: string): GitBookSection[] => {
  const files = paths
    .filter((path) => isMarkdown(path) && (!root || path.startsWith(`${root}/`)))
    .map((path) => (root ? path.slice(root.length + 1) : path))
    .filter((path) => path !== summary && !path.split('/').some((segment) => IGNORED_SEGMENT.test(segment)))
    .sort((a, b) => a.localeCompare(b));
  const fileSet = new Set(files);

  const build = (directory: string): GitBookNavNode[] => {
    const prefix = directory ? `${directory}/` : '';
    const nodes: GitBookNavNode[] = [];
    const subdirectories = new Set<string>();
    for (const file of files) {
      if (!file.startsWith(prefix)) continue;
      const rest = file.slice(prefix.length);
      const slash = rest.indexOf('/');
      if (slash >= 0) {
        subdirectories.add(rest.slice(0, slash));
        continue;
      }
      if (/^readme\.md$/i.test(rest)) continue;
      nodes.push({ kind: 'page', path: file, title: humanize(withoutExtension(rest)), children: [] });
    }
    for (const name of [...subdirectories].sort((a, b) => a.localeCompare(b))) {
      const path = `${prefix}${name}`;
      const children = build(path);
      const folderReadme = [...fileSet].find((file) => file.toLowerCase() === `${path}/readme.md`.toLowerCase());
      if (folderReadme) nodes.push({ kind: 'page', path: folderReadme, title: humanize(name), children });
      else if (children.length > 0) nodes.push({ kind: 'group', title: humanize(name), children });
    }
    return nodes;
  };

  const nodes = build('');
  if (fileSet.has(readme)) nodes.unshift({ kind: 'page', path: readme, title: 'Introduction', children: [] });
  return nodes.length > 0 ? [{ nodes }] : [];
};

/** GitBook always shows the space README first, even when SUMMARY.md omits it. */
export const ensureGitBookReadme = (sections: GitBookSection[], readme: string, exists: boolean): GitBookSection[] => {
  if (!exists) return sections;
  const listed = (nodes: readonly GitBookNavNode[]): boolean =>
    nodes.some((node) => (node.kind === 'page' && node.path === readme) || listed(node.children));
  if (sections.some((section) => listed(section.nodes))) return sections;
  return [{ nodes: [{ kind: 'page', path: readme, title: 'Introduction', children: [] }] }, ...sections];
};

export interface PlannedGitBookNode {
  kind: 'page' | 'group';
  /** Root-relative Markdown file (pages only). */
  path?: string;
  title: string;
  label?: string;
  slug: string;
  route: string;
  /** SUMMARY.md section — a virtual nav category that does not change URLs. */
  category?: string;
  categoryOrder?: number;
  children: PlannedGitBookNode[];
}

const pageSlug = (node: Extract<GitBookNavNode, { kind: 'page' }>, readme: string): string => {
  const file = posix.basename(withoutExtension(node.path));
  if (node.path === readme) return slugify(node.title) || 'introduction';
  // A folder README is the folder's page in GitBook URLs (`/guides`, not `/guides/readme`).
  const base = file.toLowerCase() === 'readme' ? posix.basename(directoryOf(node.path)) || node.title : file;
  return slugify(base) || `page-${stableHash(node.path)}`;
};

/**
 * Assign every node its slug and public route up front, so link rewriting and
 * persistence agree. Sections share the top-level slug namespace (they are
 * categories, not URL segments), matching GitBook's own URLs.
 */
export const planGitBookNavigation = (
  sections: readonly GitBookSection[],
  readme: string,
): { nodes: PlannedGitBookNode[]; routes: Map<string, string>; warnings: string[] } => {
  const routes = new Map<string, string>();
  const warnings: string[] = [];

  const plan = (nodes: readonly GitBookNavNode[], parentSegments: string[], used: Map<string, string>): PlannedGitBookNode[] =>
    nodes.map((node) => {
      const identity = node.kind === 'page' ? node.path : `group:${node.title}`;
      let slug = node.kind === 'page' ? pageSlug(node, readme) : slugify(node.title) || `group-${stableHash(node.title)}`;
      const claimedBy = used.get(slug);
      if (claimedBy !== undefined && claimedBy !== identity) {
        const fallback = (node.kind === 'page' ? slugify(withoutExtension(node.path).split('/').join('-')) : '') || `${slug}-${stableHash(identity)}`;
        warnings.push(`"${claimedBy}" and "${identity}" share the slug "${slug}" — "${identity}" was imported as "${fallback}".`);
        slug = fallback;
      }
      used.set(slug, identity);
      const segments = [...parentSegments, slug];
      const route = `/${segments.join('/')}`;
      if (node.kind === 'page') {
        const key = withoutExtension(node.path);
        routes.set(key, route);
        routes.set(encodeURI(key), route);
        if (/(?:^|\/)readme$/i.test(key)) routes.set(directoryOf(node.path) || '.', route);
      }
      return {
        kind: node.kind,
        ...(node.kind === 'page' ? { path: node.path } : {}),
        title: node.title,
        ...(node.kind === 'page' && node.label ? { label: node.label } : {}),
        slug,
        route,
        children: plan(node.children, segments, new Map()),
      };
    });

  const topLevel = new Map<string, string>();
  const nodes: PlannedGitBookNode[] = [];
  for (const [order, section] of sections.entries()) {
    for (const node of plan(section.nodes, [], topLevel)) {
      nodes.push(
        section.title && node.kind === 'page' ? { ...node, category: section.title.slice(0, 80), categoryOrder: Math.min(order, 999) } : node,
      );
    }
  }
  return { nodes, routes, warnings };
};

/** `.gitbook.yaml` redirects → project redirects, for destinations that were imported. */
export const mapGitBookRedirects = (
  redirects: GitBookSpaceConfig['redirects'],
  routes: ReadonlyMap<string, string>,
): { redirects: Array<{ from: string; to: string }>; warnings: string[] } => {
  const mapped: Array<{ from: string; to: string }> = [];
  const warnings: string[] = [];
  for (const redirect of redirects) {
    const destination = joinInside(redirect.to.split('#', 1)[0] ?? redirect.to);
    const route = destination === undefined ? undefined : routes.get(withoutExtension(destination) || '.');
    if (!route) {
      warnings.push(`Redirect "${redirect.from}" → "${redirect.to}" was skipped: the destination page was not imported.`);
      continue;
    }
    const from = `/${redirect.from.replace(/^\/+|\/+$/g, '').replace(/\.md$/i, '')}`;
    if (from !== route) mapped.push({ from, to: route });
  }
  return { redirects: mapped, warnings };
};
