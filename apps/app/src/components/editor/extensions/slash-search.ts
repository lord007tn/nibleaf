import type { Locale, MessageKey } from '@nibleaf/i18n';
import { translateFn } from '@nibleaf/i18n/react';
import type { SlashItem } from './slash-items/types';

/**
 * Slash menu search, ranking and sections (UX audit P1-ED-003).
 *
 * Matching rule: the query is split into words. An item matches when EVERY
 * query word is the start of some word in the item's title (in the page
 * language, the interface language, English or Arabic), its keywords, or its
 * internal name, in any order. Letter case, Latin accents and Arabic
 * diacritics (harakat, shadda, hamza and madda marks, tatweel) are ignored, as
 * is a leading Arabic "ال" on a word. Words are runs of letters and digits, so
 * "To-do list" is "to", "do", "list".
 *
 * Ranking: an exact title, then a title that starts with the query, then items
 * whose title alone holds every word, then items that needed a keyword; ties
 * follow the fixed most-used order below, then menu order.
 *
 * Each search is one pass over the items, and each item's cost depends only on
 * its own words, so the work grows linearly with the item count.
 */

/** 'editor.slash.codeBlock.title' → 'codeBlock'. */
const slashItemName = (item: SlashItem): string => item.titleKey.split('.')[2] ?? '';

// --- Text folding -----------------------------------------------------------

const isFoldedMark = (code: number): boolean =>
  (code >= 0x03_00 && code <= 0x03_6f) || // Latin combining accents, after NFD
  (code >= 0x06_10 && code <= 0x06_1a) || // Arabic honorific signs
  (code >= 0x06_4b && code <= 0x06_5f) || // Arabic harakat, shadda, sukun, hamza and madda marks
  code === 0x06_70 || // Arabic superscript alef
  code === 0x06_40; // Arabic tatweel

/** Letters a writer commonly types for one another. */
const LETTER_FOLDS: ReadonlyMap<string, string> = new Map([
  ['ى', 'ي'],
  ['ی', 'ي'],
  ['ة', 'ه'],
  ['ک', 'ك'],
]);

/** Lower-case `text` and drop accents and Arabic diacritics: "Étapes" → "etapes", "مرقّمة" → "مرقمه". */
const foldSlashText = (text: string): string => {
  let folded = '';
  for (const char of text.normalize('NFD').toLowerCase()) {
    if (isFoldedMark(char.codePointAt(0) ?? 0)) continue;
    folded += LETTER_FOLDS.get(char) ?? char;
  }
  return folded;
};

// Letters, combining marks (Devanagari and Bengali vowel signs are part of a word) and digits.
const NON_WORD = /[^\p{L}\p{M}\p{N}]+/u;

/** The words of an already folded text. */
const wordsOf = (folded: string): string[] => folded.split(NON_WORD).filter(Boolean);

const ARABIC_ARTICLE = 'ال';
/** A word, plus the same word without a leading Arabic article ("الملفات" → "ملفات"). */
const withArticleFree = (words: string[]): string[] =>
  words.flatMap((word) =>
    word.startsWith(ARABIC_ARTICLE) && word.length > ARABIC_ARTICLE.length + 1 ? [word, word.slice(ARABIC_ARTICLE.length)] : [word],
  );

// --- Ranking ------------------------------------------------------------------

/** Most-used blocks first; used to break ties and to fill "Suggested". */
const MOST_USED = [
  'text',
  'h1',
  'h2',
  'h3',
  'bulletList',
  'numberedList',
  'todo',
  'codeBlock',
  'image',
  'table',
  'note',
  'tip',
  'info',
  'check',
  'warning',
  'danger',
  'quote',
  'divider',
  'video',
  'tabs',
  'steps',
  'accordion',
  'cardGroup',
  'card',
  'columns2',
  'codeGroup',
  'mermaid',
  'embed',
];
const mostUsedIndex = (item: SlashItem): number => {
  const index = MOST_USED.indexOf(slashItemName(item));
  return index < 0 ? MOST_USED.length : index;
};

/** How well an item matches, best first. */
const SlashMatch = {
  exactTitle: 0,
  titlePrefix: 1,
  titleWords: 2,
  keywords: 3,
} as const;
type SlashMatchTier = (typeof SlashMatch)[keyof typeof SlashMatch];

interface PreparedQuery {
  /** Folded words joined by one space. */
  text: string;
  /** Folded words with no separator, so "codeblock" still finds "Code block". */
  compact: string;
  words: string[];
}

const prepareSlashQuery = (query: string): PreparedQuery => {
  const words = wordsOf(foldSlashText(query));
  return { text: words.join(' '), compact: words.join(''), words };
};

interface SearchEntry {
  titles: string[];
  compactTitles: string[];
  titleWords: string[];
  keywordWords: string[];
}

const uniq = (values: string[]): string[] => [...new Set(values)];

const searchEntry = (item: SlashItem, locale: Locale): SearchEntry => {
  const titleWordLists = uniq([
    translateFn(item.titleKey, undefined, locale),
    // The interface language (the runtime locale), which can differ from the page's.
    translateFn(item.titleKey),
    translateFn(item.titleKey, undefined, 'en'),
    translateFn(item.titleKey, undefined, 'ar'),
  ]).map((title) => wordsOf(foldSlashText(title)));
  return {
    titles: titleWordLists.map((words) => words.join(' ')),
    compactTitles: titleWordLists.map((words) => words.join('')),
    titleWords: withArticleFree(titleWordLists.flat()),
    keywordWords: withArticleFree(wordsOf(foldSlashText([...(item.keywords ?? []), slashItemName(item)].join(' ')))),
  };
};

const hasWordStartingWith = (words: string[], prefix: string): boolean => words.some((word) => word.startsWith(prefix));

/** How `item` matches a prepared, non-empty query, or null when some word matches nothing. */
const matchTier = (entry: SearchEntry, query: PreparedQuery): SlashMatchTier | null => {
  if (entry.titles.includes(query.text) || entry.compactTitles.includes(query.compact)) return SlashMatch.exactTitle;
  if (entry.titles.some((title) => title.startsWith(query.text)) || entry.compactTitles.some((title) => title.startsWith(query.compact)))
    return SlashMatch.titlePrefix;
  let titleOnly = true;
  for (const word of query.words) {
    if (hasWordStartingWith(entry.titleWords, word)) continue;
    if (!hasWordStartingWith(entry.keywordWords, word)) return null;
    titleOnly = false;
  }
  return titleOnly ? SlashMatch.titleWords : SlashMatch.keywords;
};

/** The items matching `query`, best first. A blank query returns `items` unchanged. */
export const searchSlashItems = (items: SlashItem[], query: string, locale: Locale = 'en'): SlashItem[] => {
  const prepared = prepareSlashQuery(query);
  if (prepared.words.length === 0) return items;
  const scored: { item: SlashItem; tier: number; used: number; order: number }[] = [];
  items.forEach((item, order) => {
    const tier = matchTier(searchEntry(item, locale), prepared);
    if (tier !== null) scored.push({ item, tier, used: mostUsedIndex(item), order });
  });
  return scored.sort((a, b) => a.tier - b.tier || a.used - b.used || a.order - b.order).map((entry) => entry.item);
};

// --- Sections -----------------------------------------------------------------

type SlashGroupKey = 'suggested' | 'basics' | 'callouts' | 'media' | 'layout' | 'api' | 'inline';

interface SlashSectionDefinition {
  key: Exclude<SlashGroupKey, 'suggested'>;
  heading: MessageKey;
  items: readonly string[];
}

/** Menu sections in menu order, each listing its items in menu order. */
const SLASH_SECTIONS: readonly SlashSectionDefinition[] = [
  {
    key: 'basics',
    heading: 'editor.slash.basicBlocks',
    items: ['text', 'h1', 'h2', 'h3', 'bulletList', 'numberedList', 'todo', 'quote', 'codeBlock', 'mermaid', 'divider'],
  },
  { key: 'callouts', heading: 'editor.slash.section.callouts', items: ['note', 'tip', 'info', 'check', 'warning', 'danger', 'banner'] },
  { key: 'media', heading: 'editor.slash.section.media', items: ['image', 'video', 'embed', 'table', 'frame'] },
  {
    key: 'layout',
    heading: 'editor.slash.section.layout',
    items: [
      'tabs',
      'steps',
      'accordion',
      'expandable',
      'columns2',
      'columns3',
      'columns4',
      'card',
      'cardGroup',
      'cardGrid3',
      'cardGrid4',
      'relatedContent',
      'relatedCard',
      'update',
    ],
  },
  {
    key: 'api',
    heading: 'editor.slash.section.api',
    items: ['paramField', 'responseField', 'apiExample', 'requestExample', 'responseExample', 'codeGroup', 'fileTree', 'folder', 'file'],
  },
  { key: 'inline', heading: 'editor.slash.section.inline', items: ['tooltip', 'icon', 'badge', 'button'] },
];

const SECTION_OF: ReadonlyMap<string, { section: number; position: number }> = new Map(
  SLASH_SECTIONS.flatMap((section, sectionIndex) => section.items.map((name, position) => [name, { section: sectionIndex, position }] as const)),
);

// An item missing from SLASH_SECTIONS still shows, at the end of Layout (a test keeps the list complete).
const FALLBACK_SECTION = SLASH_SECTIONS.findIndex((section) => section.key === 'layout');

const sectionIndexOf = (item: SlashItem): number => SECTION_OF.get(slashItemName(item))?.section ?? FALLBACK_SECTION;
// Indexes come from SECTION_OF or FALLBACK_SECTION, so they always name a section.
const sectionAt = (index: number): SlashSectionDefinition => SLASH_SECTIONS[index] ?? (SLASH_SECTIONS[0] as SlashSectionDefinition);

export const slashSectionOf = (item: SlashItem): SlashSectionDefinition => sectionAt(sectionIndexOf(item));

/** Sort key for the full menu: by section, then by position in the section. */
export const slashMenuOrder = (item: SlashItem): number => {
  const placed = SECTION_OF.get(slashItemName(item));
  return placed ? placed.section * 1000 + placed.position : FALLBACK_SECTION * 1000 + 999;
};

interface SlashMenuGroup {
  key: SlashGroupKey;
  heading: MessageKey;
  items: SlashItem[];
}

/** How many of the most-used blocks open the menu before any typing. */
const SUGGESTED_COUNT = 6;

/**
 * The menu's sections for a list already filtered and ranked by `searchSlashItems`.
 *
 * - No query: "Suggested" (the six most-used blocks), then every other block
 *   in its section, in menu order. A block appears once.
 * - Searching: matches stay grouped under their section, ranked within it, and
 *   the sections are ordered by their best match, so the first item is always
 *   the best match overall and Enter inserts it.
 */
export const groupSlashItems = (ranked: SlashItem[], query: string): SlashMenuGroup[] => {
  const searching = prepareSlashQuery(query).words.length > 0;
  const groups: SlashMenuGroup[] = [];
  let rest = ranked;
  if (!searching) {
    const suggested = [...ranked].sort((a, b) => mostUsedIndex(a) - mostUsedIndex(b)).slice(0, SUGGESTED_COUNT);
    if (suggested.length > 0) groups.push({ key: 'suggested', heading: 'editor.slash.section.suggested', items: suggested });
    const shown = new Set(suggested);
    rest = ranked.filter((item) => !shown.has(item));
  }
  const bySection = new Map<number, SlashMenuGroup>();
  for (const item of rest) {
    const index = sectionIndexOf(item);
    let group = bySection.get(index);
    if (!group) {
      const section = sectionAt(index);
      group = { key: section.key, heading: section.heading, items: [] };
      bySection.set(index, group);
    }
    group.items.push(item);
  }
  // A Map keeps insertion order: by best match while searching. With no query, use section order.
  const sections = searching ? [...bySection.values()] : [...bySection.entries()].sort(([a], [b]) => a - b).map(([, group]) => group);
  return groups.concat(sections);
};

// --- Keeping the menu open ----------------------------------------------------

/** No block name is this long; a longer "query" is ordinary text after a slash. */
const MAX_SLASH_QUERY = 64;
const isSpace = (char: string | undefined): boolean => char !== undefined && char.trim() === '';

/**
 * Whether the text typed after "/" should keep the menu open now that it may
 * contain spaces. It closes when the query starts with a space ("a / b"), holds
 * two spaces in a row, grows past any block name, or when a finished word
 * (one followed by a space) already rules out every block: words only narrow
 * the list, so nothing typed after it could match and the writer is simply
 * writing prose. `hasMatches` reports whether the finished words match anything.
 */
export const slashQueryKeepsMenuOpen = (query: string, hasMatches: (finishedWords: string) => boolean): boolean => {
  if (query.length > MAX_SLASH_QUERY) return false;
  if (query.length === 0) return true;
  if (isSpace(query[0])) return false;
  let lastSpace = -1;
  for (let index = 1; index < query.length; index += 1) {
    if (!isSpace(query[index])) continue;
    if (isSpace(query[index - 1])) return false;
    lastSpace = index;
  }
  return lastSpace < 0 || hasMatches(query.slice(0, lastSpace));
};
