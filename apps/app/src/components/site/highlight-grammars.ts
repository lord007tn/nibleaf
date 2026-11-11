import type { LanguageFn } from 'highlight.js';
import { LAZY_HIGHLIGHT_LANGUAGES, type LazyHighlightLanguage } from '@/lib/highlight-languages';

/*
 * The highlight.js grammars outside the reader's core set, one chunk each. The
 * reader loads the ones an article uses (see lib/highlight-languages.ts).
 */

type GrammarModule = Promise<{ default: LanguageFn }>;

const GRAMMARS: Record<LazyHighlightLanguage, () => GrammarModule> = {
  arduino: () => import('highlight.js/lib/languages/arduino'),
  c: () => import('highlight.js/lib/languages/c'),
  cpp: () => import('highlight.js/lib/languages/cpp'),
  csharp: () => import('highlight.js/lib/languages/csharp'),
  go: () => import('highlight.js/lib/languages/go'),
  ini: () => import('highlight.js/lib/languages/ini'),
  java: () => import('highlight.js/lib/languages/java'),
  kotlin: () => import('highlight.js/lib/languages/kotlin'),
  less: () => import('highlight.js/lib/languages/less'),
  lua: () => import('highlight.js/lib/languages/lua'),
  makefile: () => import('highlight.js/lib/languages/makefile'),
  objectivec: () => import('highlight.js/lib/languages/objectivec'),
  perl: () => import('highlight.js/lib/languages/perl'),
  php: () => import('highlight.js/lib/languages/php'),
  'php-template': () => import('highlight.js/lib/languages/php-template'),
  'python-repl': () => import('highlight.js/lib/languages/python-repl'),
  r: () => import('highlight.js/lib/languages/r'),
  ruby: () => import('highlight.js/lib/languages/ruby'),
  rust: () => import('highlight.js/lib/languages/rust'),
  scss: () => import('highlight.js/lib/languages/scss'),
  swift: () => import('highlight.js/lib/languages/swift'),
  vbnet: () => import('highlight.js/lib/languages/vbnet'),
  wasm: () => import('highlight.js/lib/languages/wasm'),
};

/** `name`'s grammar and the grammars it embeds, by language name. */
export async function loadHighlightGrammars(name: LazyHighlightLanguage): Promise<Record<string, LanguageFn>> {
  const entry = LAZY_HIGHLIGHT_LANGUAGES[name];
  const names: LazyHighlightLanguage[] = [name, ...('embeds' in entry ? entry.embeds : [])];
  return Object.fromEntries(await Promise.all(names.map(async (language) => [language, (await GRAMMARS[language]()).default] as const)));
}
