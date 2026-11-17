/**
 * The draft preview's navigation, as pure logic. It is the reader's tree
 * (`buildNavTree`) built from the draft pages, so the preview, the live site
 * and the editor's page tree all list pages in the author's order. Rendered by
 * `components/preview-nav.tsx`; tested in `preview-nav.test.ts`.
 */
import { buildNavTree, type NavNode, type NavSourcePage, type SiteSnapshot, type SnapshotPage } from '@nibleaf/shared/site';
import { resolveSitePage } from '@nibleaf/shared/site-route';

/** The draft page fields the preview's navigation reads (a dashboard `PageNode`). */
export interface DraftNavPage {
  id: string;
  parentId: string | null;
  kind: 'PAGE' | 'GROUP';
  title: string;
  slug: string;
  path: string;
  icon: string | null;
  position: number;
  hidden: boolean;
  /** Links the page to its translations in other languages (`isPageTranslation`). */
  translationKey?: string | null;
  config?: { sidebarTitle?: string; tag?: string; category?: string; categoryIcon?: string; categoryOrder?: number } | null;
}

/** A draft page in the shape navigation is built from. */
const navSourcePage = (page: DraftNavPage, languageCode: string): NavSourcePage => ({
  id: page.id,
  parentId: page.parentId,
  // The preview lists one language at a time; its code picks the "Untitled"
  // wording and the language of inferred category names.
  languageCode,
  kind: page.kind,
  title: page.title,
  slug: page.slug,
  path: page.path,
  icon: page.icon,
  config: page.config
    ? {
        sidebarTitle: page.config.sidebarTitle,
        tag: page.config.tag,
        category: page.config.category,
        categoryIcon: page.config.categoryIcon,
        categoryOrder: page.config.categoryOrder,
      }
    : null,
  position: page.position,
  hidden: page.hidden,
});

/** The previewed language's navigation, as readers will get it once published.
 *  Empty until the language is known: its pages are scoped to it, and an
 *  imported collection's category names are worded in it. */
export const previewNavTree = (pages: readonly DraftNavPage[] | undefined, languageCode: string | undefined): NavNode[] =>
  languageCode ? buildNavTree((pages ?? []).map((page) => navSourcePage(page, languageCode))) : [];

/** The languages a preview home is chosen for. */
export interface PreviewHomeLanguages {
  /** The previewed language's code. */
  code: string;
  /** The site's default language's code. */
  defaultCode: string;
}

/** The one docs version a draft snapshot holds: the preview lists one version's
 *  drafts at a time, so every page belongs to it. */
const DRAFT_VERSION = { id: 'draft', name: 'draft', slug: 'draft', isDefault: true } as const;

const snapshotPage = (page: DraftNavPage, languageCode: string): SnapshotPage => ({
  ...navSourcePage(page, languageCode),
  versionId: DRAFT_VERSION.id,
  updatedAt: '',
  description: null,
  content: '',
  translationKey: page.translationKey ?? null,
});

/**
 * The page the preview opens on: the page the reader serves at this language's
 * site root once the drafts are published. The drafts become a one-version
 * snapshot and the reader's own `resolveSitePage` picks the root, so the
 * preview follows every rule of it: a visible page with an empty address wins;
 * a translated language opens on the translation of the default language's
 * home; otherwise the first page in nav order.
 *
 * `defaultLanguagePages` are the default language's drafts in the same version
 * (unused when previewing the default language). Undefined when the reader
 * would serve none of the previewed language's pages: the reader then falls
 * back to the default language, which the preview lists separately.
 */
export function previewHomeId(
  pages: readonly DraftNavPage[] | undefined,
  defaultLanguagePages: readonly DraftNavPage[] | undefined,
  languages: PreviewHomeLanguages | undefined,
): string | undefined {
  if (!pages?.length || !languages) return undefined;
  const { code, defaultCode } = languages;
  const translated = code !== defaultCode;
  const language = (languageCode: string, isDefault: boolean) => ({
    code: languageCode,
    label: languageCode,
    direction: 'LTR' as const,
    isDefault,
    // Previewed even while disabled: the reader serves it once it is enabled.
    enabled: true,
    config: null,
  });
  const snapshot: SiteSnapshot = {
    project: {
      id: 'draft',
      name: '',
      slug: '',
      description: null,
      icon: null,
      config: null,
      languages: translated ? [language(defaultCode, true), language(code, false)] : [language(code, true)],
      versions: [DRAFT_VERSION],
    },
    pages: [
      ...pages.map((page) => snapshotPage(page, code)),
      ...(translated ? (defaultLanguagePages ?? []).map((page) => snapshotPage(page, defaultCode)) : []),
    ],
    generatedAt: '',
  };
  const home = resolveSitePage(snapshot, '', code)?.page;
  return home?.languageCode === code ? home.id : undefined;
}
