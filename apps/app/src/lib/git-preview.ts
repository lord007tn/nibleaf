import type { SiteSnapshot, SnapshotLanguage, SnapshotPage, SnapshotVersion } from '@nibleaf/shared/site';

/** The language and version a pull request preview shows, and that scope's pages. */
export interface PreviewScope {
  language: SnapshotLanguage | undefined;
  version: SnapshotVersion | undefined;
  /** Languages and versions with at least one visible page, for the scope pickers. */
  languages: SnapshotLanguage[];
  versions: SnapshotVersion[];
  pages: SnapshotPage[];
}

const visiblePages = (snapshot: SiteSnapshot) => snapshot.pages.filter((page) => page.kind === 'PAGE' && !page.hidden);

/**
 * One language and one version at a time, so the same title in two languages
 * or versions never shows twice. A requested code or id that the snapshot
 * doesn't have falls back to the default (then the first one with pages).
 */
export function previewScope(snapshot: SiteSnapshot, requested: { language?: string; versionId?: string } = {}): PreviewScope {
  const pages = visiblePages(snapshot);
  const languages = snapshot.project.languages.filter((language) => pages.some((page) => page.languageCode === language.code));
  const versions = snapshot.project.versions.filter((version) => pages.some((page) => page.versionId === version.id));
  const pick = <Item>(items: Item[], matches: (item: Item) => boolean, isDefault: (item: Item) => boolean) =>
    items.find(matches) ?? items.find(isDefault) ?? items[0];
  const language = pick(
    languages,
    (item) => item.code === requested.language,
    (item) => item.isDefault,
  );
  const version = pick(
    versions,
    (item) => item.id === requested.versionId,
    (item) => item.isDefault,
  );
  return {
    language,
    version,
    languages,
    versions,
    pages: pages.filter((page) => page.languageCode === language?.code && page.versionId === version?.id),
  };
}
