/*
 * Which highlight.js grammars an article needs beyond the reader's core set.
 *
 * The article renderer registers a core set of grammars up front
 * (components/site/reader-highlight.ts). The other languages of lowlight's
 * `common` set, which the reader highlighted before, load per language when an
 * article uses one: on the server before rendering, and in the browser before
 * hydrating (see `highlightLanguageModule` in lib/reader-hydration-modules.ts).
 */

/** Grammars that load on demand, with their aliases, and the grammars each
 *  embeds outside the core set (`php-template` highlights PHP inside). Checked
 *  against highlight.js by highlight-languages.test.ts. */
export const LAZY_HIGHLIGHT_LANGUAGES = {
  arduino: { aliases: ['ino'] },
  c: { aliases: ['h'] },
  cpp: { aliases: ['cc', 'c++', 'h++', 'hpp', 'hh', 'hxx', 'cxx'] },
  csharp: { aliases: ['cs', 'c#'] },
  go: { aliases: ['golang'] },
  ini: { aliases: ['toml'] },
  java: { aliases: ['jsp'] },
  kotlin: { aliases: ['kt', 'kts'] },
  less: { aliases: [] },
  lua: { aliases: ['pluto'] },
  makefile: { aliases: ['mk', 'mak', 'make'] },
  objectivec: { aliases: ['mm', 'objc', 'obj-c', 'obj-c++', 'objective-c++'] },
  perl: { aliases: ['pl', 'pm'] },
  php: { aliases: [] },
  'php-template': { aliases: [], embeds: ['php'] },
  'python-repl': { aliases: ['pycon'] },
  r: { aliases: [] },
  ruby: { aliases: ['rb', 'gemspec', 'podspec', 'thor', 'irb'] },
  rust: { aliases: ['rs'] },
  scss: { aliases: [] },
  swift: { aliases: [] },
  vbnet: { aliases: ['vb'] },
  wasm: { aliases: [] },
} as const satisfies Record<string, { aliases: readonly string[]; embeds?: readonly string[] }>;

export type LazyHighlightLanguage = keyof typeof LAZY_HIGHLIGHT_LANGUAGES;

const LAZY_BY_NAME = new Map<string, LazyHighlightLanguage>(
  (Object.entries(LAZY_HIGHLIGHT_LANGUAGES) as Array<[LazyHighlightLanguage, { aliases: readonly string[] }]>).flatMap(([name, { aliases }]) => [
    [name, name],
    ...aliases.map((alias): [string, LazyHighlightLanguage] => [alias, name]),
  ]),
);

/** The language of a fence's info string (```rust title="x"), also inside a
 *  list item or blockquote, and the language class of raw HTML code. */
const FENCE_LANGUAGE = /^[ \t>]*(?:(?:[-*+]|\d{1,9}[.)])[ \t]+)?(?:`{3,}|~{3,})[ \t]*([^\s`{]+)/gm;
const CLASS_LANGUAGE = /\blang(?:uage)?-([^\s"'`>]+)/g;

/**
 * The lazily loaded grammars `content` may need, sorted. Like the article's
 * rich-renderer check, it errs towards loading: a false positive downloads a
 * grammar for nothing, a false negative would leave a code block plain.
 */
export function lazyHighlightLanguages(content: string): LazyHighlightLanguage[] {
  if (typeof content !== 'string') return [];
  const found = new Set<LazyHighlightLanguage>();
  const add = (candidate: string | undefined) => {
    const name = candidate && LAZY_BY_NAME.get(candidate.toLowerCase());
    if (name) found.add(name);
  };
  let usesYaml = false;
  for (const [, language] of content.matchAll(FENCE_LANGUAGE)) {
    add(language);
    if (language && /^ya?ml$/i.test(language)) usesYaml = true;
  }
  for (const [, language] of content.matchAll(CLASS_LANGUAGE)) add(language);
  // The core YAML grammar highlights ERB tags (`<%= … %>`) as Ruby.
  if (usesYaml && content.includes('<%')) found.add('ruby');
  return [...found].sort();
}
