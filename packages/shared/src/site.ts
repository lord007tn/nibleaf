import { excerpt } from './utils';

export interface SnapshotPage {
  id: string;
  parentId: string | null;
  languageCode: string;
  kind: 'PAGE' | 'GROUP';
  title: string;
  slug: string;
  path: string;
  icon: string | null;
  description: string | null;
  content: string;
  position: number;
  hidden: boolean;
}

export interface SnapshotLanguage {
  code: string;
  label: string;
  direction: 'LTR' | 'RTL';
  isDefault: boolean;
}

export interface SnapshotProject {
  id: string;
  name: string;
  slug: string;
  description: string | null;
  icon: string | null;
  color: string;
  logoUrl: string | null;
  faviconUrl: string | null;
  theme: Record<string, unknown> | null;
  config: Record<string, unknown> | null;
  languages: SnapshotLanguage[];
}

export interface SiteSnapshot {
  project: SnapshotProject;
  pages: SnapshotPage[];
  generatedAt: string;
}

/** The default language of a snapshot (or a synthesized English fallback for
 *  legacy snapshots captured before languages existed). */
export const defaultLanguage = (project: SnapshotProject): SnapshotLanguage =>
  project.languages.find((l) => l.isDefault) ?? project.languages[0] ?? { code: 'en', label: 'English', direction: 'LTR', isDefault: true };

/** A node in the rendered navigation tree (groups contain children). */
export interface NavNode {
  id: string;
  kind: 'PAGE' | 'GROUP';
  title: string;
  path: string;
  icon: string | null;
  children: NavNode[];
}

/** Build a navigation tree from snapshot pages, hiding pages flagged `hidden`.
 *  When `languageCode` is given, only that language's pages are included. Legacy
 *  pages without a languageCode fall under the requested language so old
 *  snapshots still render. */
export const buildNavTree = (pages: SnapshotPage[], languageCode?: string): NavNode[] => {
  const visible = pages.filter((p) => !p.hidden && (!languageCode || (p.languageCode || languageCode) === languageCode));
  const byParent = new Map<string | null, SnapshotPage[]>();
  for (const page of visible) {
    const list = byParent.get(page.parentId) ?? [];
    list.push(page);
    byParent.set(page.parentId, list);
  }
  const build = (parentId: string | null): NavNode[] =>
    (byParent.get(parentId) ?? [])
      .sort((a, b) => a.position - b.position)
      .map((page) => ({
        id: page.id,
        kind: page.kind,
        title: page.title,
        path: page.path,
        icon: page.icon,
        children: build(page.id),
      }));
  return build(null);
};

const HEADING = /^(#{1,4})\s+(.+?)\s*#*$/;

export interface Heading {
  depth: number;
  text: string;
  id: string;
}

/** Extract markdown headings (h1–h4) with slug ids — powers search + the TOC. */
export const extractHeadings = (markdown: string): Heading[] => {
  const headings: Heading[] = [];
  let inFence = false;
  for (const line of markdown.split('\n')) {
    if (line.trimStart().startsWith('```')) {
      inFence = !inFence;
      continue;
    }
    if (inFence) {
      continue;
    }
    const match = HEADING.exec(line);
    if (match) {
      const text = match[2]?.trim() ?? '';
      headings.push({
        depth: match[1]?.length ?? 1,
        text,
        id: text
          .toLowerCase()
          .replace(/[^a-z0-9]+/g, '-')
          .replace(/^-+|-+$/g, ''),
      });
    }
  }
  return headings;
};

/** Build a one-line description for a page (its own, or derived from content). */
export const pageDescription = (page: Pick<SnapshotPage, 'description' | 'content'>): string => page.description?.trim() || excerpt(page.content);

type LanguageRow = { code: string; label: string; direction: string; isDefault: boolean };
type ProjectRow = {
  id: string;
  name: string;
  slug: string;
  description: string | null;
  icon: string | null;
  color: string;
  logoUrl: string | null;
  faviconUrl: string | null;
  theme: unknown;
  config?: unknown;
  languages?: LanguageRow[];
};
type PageRow = Omit<SnapshotPage, 'kind' | 'languageCode'> & { kind: string; languageCode?: string };

/** Compose an immutable site snapshot from a project + its pages (publish time). */
export const buildSnapshot = (project: ProjectRow, pages: PageRow[], generatedAt: string): SiteSnapshot => {
  const languages: SnapshotLanguage[] = (project.languages ?? []).map((l) => ({
    code: l.code,
    label: l.label,
    direction: l.direction === 'RTL' ? 'RTL' : 'LTR',
    isDefault: l.isDefault,
  }));
  const fallbackCode = languages.find((l) => l.isDefault)?.code ?? languages[0]?.code ?? 'en';
  return {
    project: {
      id: project.id,
      name: project.name,
      slug: project.slug,
      description: project.description,
      icon: project.icon,
      color: project.color,
      logoUrl: project.logoUrl,
      faviconUrl: project.faviconUrl,
      theme: (project.theme as Record<string, unknown> | null) ?? null,
      config: (project.config as Record<string, unknown> | null) ?? null,
      languages: languages.length ? languages : [{ code: 'en', label: 'English', direction: 'LTR', isDefault: true }],
    },
    pages: pages.map((page) => ({ ...page, kind: page.kind === 'GROUP' ? 'GROUP' : 'PAGE', languageCode: page.languageCode || fallbackCode })),
    generatedAt,
  };
};
