import { buildSnapshot, type SiteSnapshot } from '@nibleaf/shared/site';
import { createLinkResolver } from '@nibleaf/shared/site-links';
import { createContext, useContext } from 'react';
import type { Branch, Language, OpenApiConfiguration, PageNode, Project } from '@/hooks/api/types';
import { sectionFragment } from './editor-sections';

/**
 * Where a link in the open page leads, for the editor. A link to another page
 * of the site is stored relative (`configuration`, `/guides/setup#install`),
 * so in the dashboard the browser would resolve it against the app's own
 * domain. The editor instead resolves it the way the published site does and
 * opens that page in the editor.
 *
 * - `web`: an address with a scheme (`https:`, `mailto:`) or `//host`; the
 *   browser opens it as it always has.
 * - `page`: a page of this site (the editor opens it), and the section the
 *   link names (`#install`, decoded), if any. An in-page `#anchor` is a section
 *   of the open page.
 * - `missing`: a link into the site that reaches nothing there.
 * - `other`: a site link that isn't a page in the editor: a file, or a route
 *   such as the changelog or the API reference.
 * - `unknown`: not known yet: the site's pages are still loading, or the link
 *   may lead into another docs version whose pages haven't been loaded. It may
 *   be a page, so it can be followed (`resolveAsync` loads what it needs).
 */
export type EditorLinkTarget =
  | { kind: 'web' }
  | { kind: 'page'; pageId: string; anchor?: string }
  | { kind: 'missing' }
  | { kind: 'other' }
  | { kind: 'unknown' };

/** What the page editor offers its links: resolution and opening a page. */
export interface EditorLinks {
  /** Where `href`, written on the open page, leads. */
  resolve: (href: string) => EditorLinkTarget;
  /** Open a page of this site in the editor, in this tab, after the open page is saved, at
   *  `section` (a heading's anchor) when given. The open page itself just goes to `section`. */
  open: (pageId: string, section?: string) => void;
  /** A page's editor address, at `section` when given, for opening it in a new tab. */
  href: (pageId: string, section?: string) => string;
  /** Where `href` leads once every docs version's pages are loaded (loads them when needed). */
  resolveAsync: (href: string) => Promise<EditorLinkTarget>;
  /** Start loading the other docs versions' pages, so `resolve` can answer for links into them. */
  loadVersions: () => void;
}

/** Provided by the page editor route. Without it (other editors, tests) a site link opens nothing. */
export const EditorLinksContext = createContext<EditorLinks | null>(null);

export const useEditorLinks = () => useContext(EditorLinksContext);

const SCHEME = /^[a-z][a-z0-9+.-]*:/i;

/** Whether the browser should handle `href` itself: an absolute web address, not a link into the site. */
export const isWebAddress = (href: string): boolean => {
  const trimmed = href.trim();
  return SCHEME.test(trimmed) || trimmed.startsWith('//');
};

interface EditorSiteInput {
  project: Pick<Project, 'id' | 'name' | 'slug' | 'description' | 'icon' | 'config'>;
  languages: readonly Pick<Language, 'id' | 'code' | 'label' | 'direction' | 'isDefault' | 'config'>[];
  branches: readonly Pick<Branch, 'id' | 'name' | 'isDefault' | 'createdAt'>[];
  /** Every page of the version being edited, in every language. */
  pages: readonly PageNode[];
  /** The version being edited (pages that don't say otherwise belong to it). */
  branchId: string;
  openApi?: Pick<OpenApiConfiguration, 'title' | 'path' | 'contentHash' | 'updatedAt'> | null;
}

/**
 * The site as the editor sees it, in the published snapshot's shape so links
 * resolve with the publish checks' own resolver (`@nibleaf/shared/site-links`).
 * Two differences, both because the writer edits these pages: hidden pages and
 * pages in a language that isn't served yet are still link targets. Returns
 * null while the site can't be described (no default language or version yet).
 */
export function editorSiteSnapshot(input: EditorSiteInput): SiteSnapshot | null {
  const codeById = new Map(input.languages.map((language) => [language.id, language.code]));
  // Version slugs are assigned in publish order: the default version first, then oldest first.
  const branches = [...input.branches].sort(
    (a, b) => Number(b.isDefault) - Number(a.isDefault) || a.createdAt.localeCompare(b.createdAt) || a.id.localeCompare(b.id),
  );
  try {
    return buildSnapshot(
      {
        ...input.project,
        languages: input.languages.map((language) => ({ ...language, enabled: true, config: language.config ?? null })),
        branches,
        openApiDocument: input.openApi ? { ...input.openApi, document: {} } : null,
      },
      input.pages.flatMap((page) => {
        const languageCode = codeById.get(page.languageId);
        if (!languageCode) return [];
        return [
          {
            id: page.id,
            parentId: page.parentId,
            branchId: page.branchId ?? input.branchId,
            updatedAt: page.updatedAt,
            languageCode,
            kind: page.kind,
            title: page.title,
            slug: page.slug,
            path: page.path,
            icon: page.icon,
            description: page.description,
            content: '',
            config: page.config ?? null,
            translationKey: page.translationKey ?? null,
            position: page.position,
            hidden: false,
          },
        ];
      }),
      new Date(0).toISOString(),
    );
  } catch {
    return null;
  }
}

/**
 * Resolve the links of one page against the editor's site. The resolver caches
 * each destination, so build it once per site and page.
 *
 * The editor loads the pages of the version it edits. Until the other versions'
 * pages are in `site` too (`allVersions`), a link that reaches nothing may still
 * lead into one of them (`/v2/setup`), so it is `unknown`, never `missing`.
 */
export function editorLinkResolver(
  site: SiteSnapshot | null,
  fromPageId: string | undefined,
  { allVersions = true }: { allVersions?: boolean } = {},
): (href: string) => EditorLinkTarget {
  const from = site?.pages.find((page) => page.id === fromPageId);
  const resolveLink = site ? createLinkResolver(site) : null;
  return (href) => {
    if (isWebAddress(href)) return { kind: 'web' };
    const trimmed = href.trim();
    const hashAt = trimmed.indexOf('#');
    const anchor = hashAt >= 0 ? sectionFragment(trimmed.slice(hashAt + 1)) : '';
    const section = anchor ? { anchor } : {};
    // An in-page anchor: a section of the open page, known before the site loads.
    if (hashAt === 0) return anchor && fromPageId ? { kind: 'page', pageId: fromPageId, anchor } : { kind: 'other' };
    if (!trimmed) return { kind: 'other' };
    if (!(resolveLink && from)) return { kind: 'unknown' };
    const destination = resolveLink(trimmed, from);
    if (destination === false) return !allVersions && (site?.project.versions.length ?? 0) > 1 ? { kind: 'unknown' } : { kind: 'missing' };
    if (destination === null || destination === true || destination.kind !== 'PAGE') return { kind: 'other' };
    return { kind: 'page', pageId: destination.id, ...section };
  };
}
