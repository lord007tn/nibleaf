import { languageConfigSchema, projectConfigUpdateSchema } from '@nibleaf/validators';

/**
 * Site configuration → Navbar, as pure logic. One form edits the active
 * scope: "default" edits the project's `config.navbar` (CTA label and URL,
 * links, tabs, anchors, and the search and changelog switches); a language
 * scope edits that language's `config.navbar` override, which localizes the
 * CTA label and the three lists only. The CTA URL and both switches stay
 * global and are never part of a language save. Rendered by
 * `components/navbar-settings.tsx`.
 */

/** A stored link (navbar link or tab). `external` is kept as stored, even though the form has no switch for it. */
type StoredLink = { label: string; href: string; external?: boolean };
type StoredAnchor = StoredLink & { icon?: string };

/** The project's `config.navbar` as the API stores it. */
export type NavbarConfig = {
  ctaLabel?: string;
  ctaUrl?: string;
  links?: StoredLink[];
  tabs?: StoredLink[];
  anchors?: StoredAnchor[];
  showSearch?: boolean;
  changelog?: boolean;
};

/** A language's `config.navbar` override: the CTA label and the lists only. */
export type LanguageNavbarConfig = Pick<NavbarConfig, 'ctaLabel' | 'links' | 'tabs' | 'anchors'>;

/** One row of a list as the form holds it: the text as typed, and `external` only when it was stored. */
export type NavRow = { label: string; href: string; external?: boolean };
/** An anchor row: a link with an icon name (blank when it has none). */
export type AnchorRow = NavRow & { icon: string };

/**
 * The form's values, the same shape in every scope so one draft follows the
 * scope picker. In a language scope `ctaUrl`, `showSearch` and `changelog`
 * are the project's, shown read-only and never sent.
 */
export type NavbarValues = {
  ctaLabel: string;
  ctaUrl: string;
  links: NavRow[];
  tabs: NavRow[];
  anchors: AnchorRow[];
  showSearch: boolean;
  changelog: boolean;
};

export type RowList = 'links' | 'tabs' | 'anchors';
export const ROW_LISTS: readonly RowList[] = ['links', 'tabs', 'anchors'];
export type RowField = 'label' | 'href' | 'icon';

type CtaKey = 'ctaLabel' | 'ctaUrl';

/** The scope the picker selects: the project ("default") or a language id. */
export const PROJECT_SCOPE = 'default';

const navRow = ({ label, href, external }: StoredLink): NavRow => ({ label, href, ...(external === undefined ? {} : { external }) });
const anchorRow = (anchor: StoredAnchor): AnchorRow => ({ ...navRow(anchor), icon: anchor.icon ?? '' });

/** The project scope's values: unset texts are blank, search shows unless turned off, and the changelog link is off unless turned on. */
export function navbarValues(navbar: NavbarConfig | null | undefined): NavbarValues {
  return {
    ctaLabel: navbar?.ctaLabel ?? '',
    ctaUrl: navbar?.ctaUrl ?? '',
    links: (navbar?.links ?? []).map(navRow),
    tabs: (navbar?.tabs ?? []).map(navRow),
    anchors: (navbar?.anchors ?? []).map(anchorRow),
    showSearch: navbar?.showSearch !== false,
    changelog: navbar?.changelog === true,
  };
}

/** A language scope's values: its own CTA label and lists (blank and empty when it uses the project's) beside the project's global fields. */
export function languageNavbarValues(
  override: LanguageNavbarConfig | null | undefined,
  projectNavbar: NavbarConfig | null | undefined,
): NavbarValues {
  const own = navbarValues(override);
  return { ...navbarValues(projectNavbar), ctaLabel: own.ctaLabel, links: own.links, tabs: own.tabs, anchors: own.anchors };
}

const isBlankRow = (row: NavRow) => !row.label.trim() && !row.href.trim();

/** A list as a save sends it: fully blank rows left out; every other row in order, its text as typed, with its `external`. */
export const cleanRows = (rows: readonly NavRow[]): StoredLink[] => rows.filter((row) => !isBlankRow(row)).map(navRow);

/** Anchors as a save sends them: as `cleanRows`, with the icon trimmed, or left out when blank. */
export const cleanAnchors = (rows: readonly AnchorRow[]): StoredAnchor[] =>
  rows.filter((row) => !isBlankRow(row)).map((row) => ({ ...navRow(row), ...(row.icon.trim() ? { icon: row.icon.trim() } : {}) }));

/**
 * The project scope's `config.navbar` patch: every field, so the save states
 * the whole navbar.
 *
 * The lists are always sent, so removing the last row sends `[]`, and both
 * switches are sent as chosen. Both CTA texts are always sent, trimmed, a
 * blank one as `''`: the API merges `navbar` key by key and keeps any key a
 * patch leaves out, so an omitted text would come back after the save. No
 * reader tells `''` from a CTA never set: the published navbar shows the CTA
 * only when both texts are non-empty, and a language's override only lays its
 * non-empty texts over the project's. So nothing needs to know whether the
 * server held a text before.
 */
export function projectNavbarPatch(values: NavbarValues): NavbarConfig {
  return {
    ctaLabel: values.ctaLabel.trim(),
    ctaUrl: values.ctaUrl.trim(),
    links: cleanRows(values.links),
    tabs: cleanRows(values.tabs),
    anchors: cleanAnchors(values.anchors),
    showSearch: values.showSearch,
    changelog: values.changelog,
  };
}

/**
 * A language scope's `config` patch: the FULL override with its non-empty
 * pieces only (the trimmed CTA label and each list with rows), or
 * `{ navbar: null }` when every piece is empty, so the language falls back to
 * the project's navbar. The server replaces the override as a whole and keeps
 * the language's name, description, SEO and other chrome.
 */
export function languageNavbarConfig(values: NavbarValues): { navbar: LanguageNavbarConfig | null } {
  const navbar: LanguageNavbarConfig = {};
  const ctaLabel = values.ctaLabel.trim();
  if (ctaLabel) navbar.ctaLabel = ctaLabel;
  const links = cleanRows(values.links);
  if (links.length > 0) navbar.links = links;
  const tabs = cleanRows(values.tabs);
  if (tabs.length > 0) navbar.tabs = tabs;
  const anchors = cleanAnchors(values.anchors);
  if (anchors.length > 0) navbar.anchors = anchors;
  return { navbar: Object.keys(navbar).length > 0 ? navbar : null };
}

/**
 * The values a save of `values` stores in its scope, read back as the form
 * reads them. The draft hook records this as what the save sent, so the
 * server echoing trimmed text, an omitted icon or a list without its blank
 * rows is recognised as the save's own echo. A language save leaves the
 * global fields as they are.
 */
export function sentNavbarValues(scope: 'project' | 'language', values: NavbarValues): NavbarValues {
  if (scope === 'project') return navbarValues(projectNavbarPatch(values));
  const { ctaLabel, links, tabs, anchors } = languageNavbarValues(languageNavbarConfig(values).navbar, null);
  return { ...values, ctaLabel, links, tabs, anchors };
}

/** A new blank row at the end of a list. A blank row is left out of a save. */
export const addRow = <T extends NavRow>(rows: readonly T[], blank: T): T[] => [...rows, blank];

/** Sets one field of one row, keeping its other fields (and `external`) as they are. */
export const editRow = <T extends NavRow>(rows: readonly T[], index: number, field: keyof T & RowField, text: string): T[] =>
  rows.map((row, position) => (position === index ? { ...row, [field]: text } : row));

/** The rows without the one at `index`, and that row as it was, to offer it back. */
export const removeRow = <T>(rows: readonly T[], index: number) => ({
  rows: rows.filter((_, position) => position !== index),
  removed: rows[index],
});

/** Puts a removed row back at `index` (or at the end, if the list got shorter), keeping every other row as it is now. */
export const restoreRow = <T>(rows: readonly T[], index: number, row: T): T[] => [...rows.slice(0, index), row, ...rows.slice(index)];

/** One thing the API's validator would refuse, located in the draft. */
export type NavbarProblem = {
  /** The CTA field, or the list, to fix. */
  key: CtaKey | RowList;
  /** The draft rows to fix (lists only). */
  rows: number[];
  /** Which of their fields to mark (lists only). */
  fields: RowField[];
  /** The validator's own message. */
  message: string;
};

const projectNavbarSchema = projectConfigUpdateSchema.shape.navbar;
const languageNavbarSchema = languageConfigSchema.shape.navbar;

/** The draft positions of the rows a save keeps, in order: the sent list's index `i` is draft row `kept[i]`. */
const keptRows = (rows: readonly NavRow[]) => rows.flatMap((row, index) => (isBlankRow(row) ? [] : [index]));

/**
 * What stops the draft from saving: the API's own navbar schema run on the
 * patch the save would send (the URL scheme block-list, the text lengths and
 * the row caps). Fully blank rows are never sent, so they are never a
 * problem; a half-filled row is sent and judged as it is.
 *
 * Each problem points at the draft fields that fix it. Too many rows names no
 * row, so it points at the rows past the cap.
 */
export function navbarProblems(scope: 'project' | 'language', values: NavbarValues): NavbarProblem[] {
  const result =
    scope === 'project'
      ? projectNavbarSchema.safeParse(projectNavbarPatch(values))
      : languageNavbarSchema.safeParse(languageNavbarConfig(values).navbar);
  if (result.success) return [];
  return result.error.issues.map((issue) => {
    const [key, position, field] = issue.path as [CtaKey | RowList, number | undefined, RowField | undefined];
    if (key === 'ctaLabel' || key === 'ctaUrl') return { key, rows: [], fields: [], message: issue.message };
    const kept = keptRows(values[key]);
    const rows =
      position === undefined ? kept.slice(issue.code === 'too_big' && 'maximum' in issue ? Number(issue.maximum) : 0) : [kept[position] ?? 0];
    return { key, rows, fields: field ? [field] : ['label', 'href'], message: issue.message };
  });
}
