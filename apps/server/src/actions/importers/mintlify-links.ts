import { posix } from 'node:path';
import { slugify } from '@nibleaf/shared';
import { stableHash } from './content';
import type { NavNode } from './mintlify-mapping';

const MARKDOWN_LINK = /(?<!!)\[([^\]]+)\]\(([^\s)]+)((?:\s+["'][^)]*["'])?)\)/g;
const HREF_ATTRIBUTE = /(\bhref\s*=\s*["'])([^"']+)(["'])/gi;

const normalizedSourcePath = (value: string): string =>
  posix
    .normalize(
      value
        .replace(/^\/+/, '')
        .replace(/\.(?:md|mdx)$/i, '')
        .replace(/\/+$/, ''),
    )
    .replace(/^\.\//, '');

/** Build the exact public route each Mintlify navigation page receives after
 * its groups become Nibleaf GROUP pages. The sibling slug ledger mirrors the
 * importer so basename collisions remain deterministic. */
export const buildMintlifyRouteMap = (nodes: readonly NavNode[]): ReadonlyMap<string, string> => {
  const routes = new Map<string, string>();
  const visit = (items: readonly NavNode[], parentSegments: string[]) => {
    const usedSlugs = new Map<string, string>();
    for (const node of items) {
      if (node.kind === 'group') {
        const groupSlug = slugify(node.slug ?? node.title) || `group-${stableHash(node.title)}`;
        visit(node.children, [...parentSegments, groupSlug]);
        continue;
      }
      let leafSlug = slugify(node.path.split('/').pop() ?? node.path) || `page-${stableHash(node.path)}`;
      const prior = usedSlugs.get(leafSlug);
      if (prior && prior !== node.path) leafSlug = slugify(node.path) || `page-${stableHash(node.path)}`;
      usedSlugs.set(leafSlug, node.path);
      routes.set(normalizedSourcePath(node.path), `/${[...parentSegments, leafSlug].join('/')}`);
    }
  };
  visit(nodes, []);
  return routes;
};

const splitSuffix = (reference: string): { path: string; suffix: string } => {
  const index = reference.search(/[?#]/);
  return index === -1 ? { path: reference, suffix: '' } : { path: reference.slice(0, index), suffix: reference.slice(index) };
};

const internalReferenceKey = (reference: string, sourcePage: string): string | null => {
  if (!reference || /^(?:[a-z][a-z0-9+.-]*:|#|\/\/)/i.test(reference)) return null;
  const { path } = splitSuffix(reference);
  const sourceDirectory = posix.dirname(normalizedSourcePath(sourcePage));
  return normalizedSourcePath(path.startsWith('/') ? path : posix.join(sourceDirectory === '.' ? '' : sourceDirectory, path));
};

/** Source-page paths referenced from Markdown or MDX anchors. Used by the
 * importer to include linked hidden pages that Mintlify permits outside nav. */
export const mintlifyInternalLinkTargets = (content: string, sourcePage: string): string[] => {
  const targets = new Set<string>();
  const add = (reference: string) => {
    const key = internalReferenceKey(reference, sourcePage);
    if (key) targets.add(key);
  };
  content.replace(MARKDOWN_LINK, (_match, _label: string, reference: string) => {
    add(reference);
    return _match;
  });
  content.replace(HREF_ATTRIBUTE, (_match, _before: string, reference: string) => {
    add(reference);
    return _match;
  });
  return [...targets];
};

/** Rewrite links between source Mintlify pages to the grouped public routes
 * produced by the import, preserving external URLs, queries, and fragments. */
export const rewriteMintlifyInternalLinks = (content: string, sourcePage: string, routes: ReadonlyMap<string, string>): string => {
  const rewrite = (reference: string): string => {
    if (!reference || /^(?:[a-z][a-z0-9+.-]*:|#|\/\/)/i.test(reference)) return reference;
    const { suffix } = splitSuffix(reference);
    const key = internalReferenceKey(reference, sourcePage);
    if (!key) return reference;
    const target = routes.get(key);
    return target ? `${target}${suffix}` : reference;
  };
  const markdown = content.replace(
    MARKDOWN_LINK,
    (_match, label: string, reference: string, title: string) => `[${label}](${rewrite(reference)}${title})`,
  );
  return markdown.replace(HREF_ATTRIBUTE, (_match, before: string, reference: string, after: string) => `${before}${rewrite(reference)}${after}`);
};
