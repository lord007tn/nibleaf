import hljs from 'highlight.js/lib/core';
import { common } from 'lowlight';
import { describe, expect, it } from 'vitest';
import { CORE_HIGHLIGHT_GRAMMARS } from '@/components/site/reader-highlight';
import { LAZY_HIGHLIGHT_LANGUAGES, lazyHighlightLanguages } from './highlight-languages';

/** Languages a grammar hands parts of its code to (`subLanguage`). */
const embeddedLanguages = (name: string): string[] => {
  const grammar = common[name];
  if (!grammar) throw new Error(`lowlight has no ${name} grammar`);
  const found = new Set<string>();
  const seen = new Set<object>();
  const walk = (mode: unknown) => {
    if (!mode || typeof mode !== 'object' || seen.has(mode)) return;
    seen.add(mode);
    const { subLanguage, contains, starts, variants } = mode as Record<string, unknown>;
    for (const language of [subLanguage].flat()) if (typeof language === 'string') found.add(language);
    for (const child of [contains, starts, variants].flat()) walk(child);
  };
  walk(grammar(hljs));
  return [...found];
};

describe('the reader’s highlight.js grammars', () => {
  const lazy = Object.keys(LAZY_HIGHLIGHT_LANGUAGES);
  const core = Object.keys(CORE_HIGHLIGHT_GRAMMARS);

  it('cover exactly lowlight’s common set, which the reader highlighted before, each once', () => {
    expect([...core, ...lazy].sort()).toEqual(Object.keys(common).sort());
    expect(core.filter((name) => lazy.includes(name))).toEqual([]);
  });

  it.each(lazy)('lists the aliases %s registers', (name) => {
    expect([...LAZY_HIGHLIGHT_LANGUAGES[name as keyof typeof LAZY_HIGHLIGHT_LANGUAGES].aliases]).toEqual(common[name]?.(hljs).aliases ?? []);
  });

  it.each(lazy)('loads every grammar %s embeds outside the core set', (name) => {
    const entry = LAZY_HIGHLIGHT_LANGUAGES[name as keyof typeof LAZY_HIGHLIGHT_LANGUAGES];
    const outsideCore = embeddedLanguages(name).filter((language) => language in common && !core.includes(language));
    expect(['embeds' in entry ? entry.embeds : []].flat().sort()).toEqual(outsideCore.sort());
  });

  it('keeps every grammar a core grammar embeds in the core set, except Ruby for YAML’s ERB tags', () => {
    const missing = core.flatMap((name) =>
      embeddedLanguages(name)
        .filter((language) => language in common && !core.includes(language))
        .map((language) => `${name}→${language}`),
    );
    expect(missing).toEqual(['yaml→ruby']);
  });
});

describe('lazyHighlightLanguages', () => {
  it('finds nothing to load for code in core languages, or with no language', () => {
    expect(lazyHighlightLanguages('```ts\nconst a = 1;\n```\n\n```bash\nnpm i\n```\n\n```\nplain\n```\n\n```json\n{}\n```')).toEqual([]);
  });

  it('reads fence languages and aliases, in list items, blockquotes and components, in any case', () => {
    const content = [
      '```rust title="main.rs"',
      'fn main() {}',
      '```',
      '- Step one:',
      '  ```Go',
      '  package main',
      '  ```',
      '> ~~~rb',
      '> puts 1',
      '> ~~~',
      '<CodeGroup>',
      '    ```c++ {2}',
      '    int x;',
      '    ```',
      '</CodeGroup>',
    ].join('\n');
    expect(lazyHighlightLanguages(content)).toEqual(['cpp', 'go', 'ruby', 'rust']);
  });

  it('reads the language classes of raw HTML code', () => {
    expect(lazyHighlightLanguages('<pre><code class="language-kotlin">val a = 1</code></pre>')).toEqual(['kotlin']);
  });

  it('loads Ruby for YAML with ERB tags, which the YAML grammar highlights as Ruby', () => {
    expect(lazyHighlightLanguages('```yaml\nname: <%= ENV["NAME"] %>\n```')).toEqual(['ruby']);
    expect(lazyHighlightLanguages('```yaml\nname: docs\n```')).toEqual([]);
  });

  it('ignores words that only look like languages', () => {
    expect(lazyHighlightLanguages('A language-agnostic guide. Write `rust` or C# code.')).toEqual([]);
  });
});
