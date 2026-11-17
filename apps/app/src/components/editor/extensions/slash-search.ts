import type { Locale, MessageKey } from '@nibleaf/i18n';
import { translateFn } from '@nibleaf/i18n/react';
import type { SlashItem } from './slash-items/types';

/**
 * Slash menu search, ranking and sections (UX audit P1-ED-003).
 *
 * Matching rule: the query is split into words at whitespace, and only at
 * whitespace. An item matches when EVERY query word is the start of one of the
 * item's indexed words, in any order. The indexed words come from its title (in
 * the page language, the interface language, English and Arabic), its keywords
 * and its internal name: each whitespace-separated word as written ("to-do",
 * "3-card"), the letter-and-digit parts inside it ("to", "do"), and Arabic
 * words without a leading "ال". Letter case, Latin accents and Arabic
 * diacritics (harakat, shadda, hamza and madda marks, tatweel) are ignored.
 *
 * Punctuation in a query word is therefore matched literally: "to-do" finds
 * To-do list, but "code?", "(code)", "code\block" or "?" find nothing, because no
 * block's words hold those characters. So, apart from words separated by
 * spaces and the accent and diacritic folding, every query this matches is a
 * substring of the text main's matcher searched; a single word main matched to
 * nothing still matches nothing (slash-differential.test.ts).
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

/**
 * Default-ignorable code points are never folded and never count as letters:
 * the combining grapheme joiner (U+034F, inside the accent block), variation
 * selectors, Mongolian free variation selectors, zero-width and direction
 * marks, word joiners, tags and the rest. They stay literal, so a query holding
 * one matches nothing (no block name holds them) and the menu closes.
 *
 * A real combining mark: General_Category Mn, Mc or Me, and not default-ignorable.
 */
const COMBINING_MARK = /^(?!\p{Default_Ignorable_Code_Point})\p{M}$/u;
/** Latin combining accents, as NFD writes "é" (e + U+0301). */
const isLatinAccent = (char: string, code: number): boolean => code >= 0x03_00 && code <= 0x03_6f && COMBINING_MARK.test(char);
const isArabicMark = (char: string, code: number): boolean =>
  ((code >= 0x06_10 && code <= 0x06_1a) || // Arabic honorific signs
    (code >= 0x06_4b && code <= 0x06_5f) || // Arabic harakat, shadda, sukun, hamza and madda marks
    code === 0x06_70) && // Arabic superscript alef
  COMBINING_MARK.test(char);
const TATWEEL = 0x06_40;
/** The characters folding may drop (where they sit on a letter): Latin accents, Arabic marks and tatweel. */
const isFoldable = (char: string): boolean => {
  const code = char.codePointAt(0) ?? 0;
  return isLatinAccent(char, code) || isArabicMark(char, code) || code === TATWEEL;
};
const LETTER = /^(?!\p{Default_Ignorable_Code_Point})\p{L}$/u;
const ARABIC_LETTER = /^\p{Script=Arabic}$/u;

/** Letters a writer commonly types for one another. */
const LETTER_FOLDS: ReadonlyMap<string, string> = new Map([
  ['ى', 'ي'],
  ['ی', 'ي'],
  ['ة', 'ه'],
  ['ک', 'ك'],
]);

/**
 * Lower-case `text` and drop accents and Arabic diacritics where they sit on a
 * letter: "Étapes" → "etapes", "مرقّمة" → "مرقمه", "ملاحظـــة" → "ملاحظه".
 *
 * What is dropped: a real combining mark (General_Category Mn, Mc or Me, never
 * a default-ignorable code point) from the Latin accent block, after any
 * letter; one of the Arabic marks, after an Arabic letter; and tatweel (the
 * Arabic stretching letter), after an Arabic letter. Other marks (Devanagari
 * and Bengali vowel signs, say) are part of their words and kept. A mark with
 * no such letter before it (at the start of a word, after a digit or
 * punctuation, or a word made only of marks) is kept, so it matches nothing
 * instead of vanishing; so is every default-ignorable code point.
 */
const foldSlashText = (text: string): string => {
  let folded = '';
  // The kind of letter the next marks would sit on.
  let base: 'arabic' | 'letter' | null = null;
  for (const char of text.normalize('NFD').toLowerCase()) {
    const code = char.codePointAt(0) ?? 0;
    if (isLatinAccent(char, code) && base) continue;
    if ((isArabicMark(char, code) || code === TATWEEL) && base === 'arabic') continue;
    if (!isFoldable(char)) base = LETTER.test(char) ? (ARABIC_LETTER.test(char) ? 'arabic' : 'letter') : null;
    folded += LETTER_FOLDS.get(char) ?? char;
  }
  return folded;
};

/** A folded query word that can't be part of any block name: empty, holding whitespace other than a plain space, or a mark that sat on no letter. */
const unmatchableWord = (folded: string): boolean => {
  if (folded === '') return true;
  for (const char of folded) if (char.trim() === '' || isFoldable(char)) return true;
  return false;
};

// Letters, combining marks (Devanagari and Bengali vowel signs are part of a word) and digits.
const NON_WORD = /[^\p{L}\p{M}\p{N}]+/u;
/** A letter, mark or digit that is not default-ignorable. */
const WORD_CHARACTER = /^(?!\p{Default_Ignorable_Code_Point})[\p{L}\p{M}\p{N}]$/u;
const WHITESPACE = /\s+/u;

/** The whitespace-separated words of an already folded text, punctuation kept. */
const wordsOf = (folded: string): string[] => folded.split(WHITESPACE).filter(Boolean);

/** Each word, plus the letter-and-digit parts inside it: "to-do" → "to-do", "to", "do". */
const withParts = (words: string[]): string[] =>
  words.flatMap((word) => {
    const parts = word.split(NON_WORD).filter(Boolean);
    return parts.length === 1 && parts[0] === word ? [word] : [word, ...parts];
  });

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
  words: string[];
  /** False when some word can't be part of any block name, so the query matches nothing. */
  matchable: boolean;
}

/**
 * No block name is this long; a longer "query" is ordinary text after a slash.
 * Checked on the raw text before any folding: NFD normalization of a long run
 * of alternating combining marks (canonical reordering) grows faster than
 * linearly, and a query this long is rejected anyway.
 */
const MAX_SLASH_QUERY = 64;

/**
 * Split at plain spaces only, then fold each word. Other whitespace (no-break
 * and typographic spaces, tabs, the ideographic space) never separates words:
 * main ended its query there, so here it makes the query match nothing. So does
 * a word that is only marks or tatweel, which would otherwise fold away.
 */
const prepareSlashQuery = (query: string): PreparedQuery => {
  // Longer than any block name: matches nothing, and is never folded or normalized.
  if (query.length > MAX_SLASH_QUERY) return { text: '', words: [], matchable: false };
  const words: string[] = [];
  let matchable = true;
  for (const raw of query.split(' ')) {
    if (raw === '') continue;
    const word = foldSlashText(raw);
    if (unmatchableWord(word)) matchable = false;
    words.push(word);
  }
  return { text: words.join(' '), words, matchable };
};

interface SearchEntry {
  /** Each title's folded words joined by one space. */
  titles: string[];
  titleWords: string[];
  keywordWords: string[];
  /** Characters in the titles and keywords that are not letters, marks, digits or spaces ("-" in "To-do list"). */
  punctuation: Set<string>;
}

const uniq = (values: string[]): string[] => [...new Set(values)];

/** Prepared entries per item, keyed by the titles they were built from (so a language change rebuilds them). */
const entryCache = new WeakMap<SlashItem, Map<string, SearchEntry>>();

const searchEntry = (item: SlashItem, locale: Locale): SearchEntry => {
  const rawTitles = uniq([
    translateFn(item.titleKey, undefined, locale),
    // The interface language (the runtime locale), which can differ from the page's.
    translateFn(item.titleKey),
    translateFn(item.titleKey, undefined, 'en'),
    translateFn(item.titleKey, undefined, 'ar'),
  ]);
  const cacheKey = rawTitles.join('\u0000');
  let cached = entryCache.get(item);
  const hit = cached?.get(cacheKey);
  if (hit) return hit;
  const titleWordLists = rawTitles.map((title) => wordsOf(foldSlashText(title)));
  const keywordWords = wordsOf(foldSlashText([...(item.keywords ?? []), slashItemName(item)].join(' ')));
  const punctuation = new Set<string>();
  for (const word of [...titleWordLists.flat(), ...keywordWords]) for (const char of word) if (!WORD_CHARACTER.test(char)) punctuation.add(char);
  const entry: SearchEntry = {
    titles: titleWordLists.map((words) => words.join(' ')),
    titleWords: withArticleFree(withParts(titleWordLists.flat())),
    keywordWords: withArticleFree(withParts(keywordWords)),
    punctuation,
  };
  if (!cached) {
    cached = new Map();
    entryCache.set(item, cached);
  }
  cached.set(cacheKey, entry);
  return entry;
};

const hasWordStartingWith = (words: string[], prefix: string): boolean => words.some((word) => word.startsWith(prefix));

/** How `item` matches a prepared, non-empty query, or null when some word matches nothing. */
const matchTier = (entry: SearchEntry, query: PreparedQuery): SlashMatchTier | null => {
  if (entry.titles.includes(query.text)) return SlashMatch.exactTitle;
  if (entry.titles.some((title) => title.startsWith(query.text))) return SlashMatch.titlePrefix;
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
  if (!prepared.matchable) return [];
  if (prepared.words.length === 0) return items;
  const scored: { item: SlashItem; tier: number; used: number; order: number }[] = [];
  items.forEach((item, order) => {
    const tier = matchTier(searchEntry(item, locale), prepared);
    if (tier !== null) scored.push({ item, tier, used: mostUsedIndex(item), order });
  });
  return scored.sort((a, b) => a.tier - b.tier || a.used - b.used || a.order - b.order).map((entry) => entry.item);
};

/**
 * Whether the text after the slash could be a slash command at all. Every word
 * must be matchable (see prepareSlashQuery: no mark-only word, no whitespace
 * but plain spaces), and every character a letter, a mark on a letter, a digit,
 * or a punctuation character that occurs in the title or keywords of one of
 * `items` (in the languages searched). "/" and "\" never are (paths). Anything
 * else ("?", "!", "#", "(", "؟", "،", a zero-width space or joiner, a direction
 * mark) means it is not a command.
 */
export const slashQueryCouldMatch = (query: string, items: SlashItem[], locale: Locale = 'en'): boolean => {
  const prepared = prepareSlashQuery(query);
  if (!prepared.matchable) return false;
  let known: Set<string> | null = null;
  for (const char of prepared.words.join('')) {
    if (WORD_CHARACTER.test(char)) continue;
    if (char === '/' || char === '\\') return false;
    if (!known) {
      known = new Set();
      for (const item of items) for (const mark of searchEntry(item, locale).punctuation) known.add(mark);
    }
    if (!known.has(char)) return false;
  }
  return true;
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
  const prepared = prepareSlashQuery(query);
  const searching = !prepared.matchable || prepared.words.length > 0;
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

/** A second slash or a backslash: a path or URL, never a block name. */
const PATH_SEPARATORS = ['/', '\\'];
const isSpace = (char: string | undefined): boolean => char !== undefined && char.trim() === '';

/**
 * Whether the text typed after "/" should keep the menu open now that it may
 * contain spaces. It closes when the query holds another "/" or a "\" (a path or
 * URL such as "/usr/local/bin", "See /code/block" or "/code\block": main's
 * trigger ended the query at a second slash, and only whitespace now continues
 * it), starts with a space
 * ("a / b"), holds two spaces in a row, grows past any block name, or when a finished word
 * (one followed by a space) already rules out every block: words only narrow
 * the list, so nothing typed after it could match and the writer is simply
 * writing prose. `hasMatches` reports whether the finished words match anything.
 */
export const slashQueryKeepsMenuOpen = (query: string, hasMatches: (finishedWords: string) => boolean): boolean => {
  if (query.length > MAX_SLASH_QUERY) return false;
  if (query.length === 0) return true;
  if (PATH_SEPARATORS.some((separator) => query.includes(separator))) return false;
  if (isSpace(query[0])) return false;
  let lastSpace = -1;
  for (let index = 1; index < query.length; index += 1) {
    if (!isSpace(query[index])) continue;
    if (isSpace(query[index - 1])) return false;
    lastSpace = index;
  }
  return lastSpace < 0 || hasMatches(query.slice(0, lastSpace));
};
