import type { Element, Root } from 'hast';
import type { LanguageFn } from 'highlight.js';
import { common } from 'lowlight';
import rehypeHighlight from 'rehype-highlight';
import { describe, expect, it } from 'vitest';
import { LAZY_HIGHLIGHT_LANGUAGES, type LazyHighlightLanguage } from '@/lib/highlight-languages';
import { loadHighlightGrammars } from './highlight-grammars';
import { CORE_HIGHLIGHT_GRAMMARS, rehypeReaderHighlight } from './reader-highlight';

/*
 * The reader's plugin must highlight exactly as rehype-highlight (with
 * lowlight's common grammars) did, for every language, once the grammars a
 * page needs are loaded.
 */

const SAMPLE = [
  '#!/usr/bin/env run',
  'function greet(name) { return `Hello, ` + name; } // comment',
  'const query = gql`{ user(id: 1) { name } }`;',
  '<div class="note" onclick="go()"><script>let a = 1;</script><style>p { color: red; }</style></div>',
  '<?php echo $user->name; ?> <%= @user.name %>',
  'SELECT id, "name" FROM users WHERE id = 1; -- comment',
  'key: value  # comment',
  '>>> print(1 + 2)',
  '$ npm install && echo "$HOME"',
  '+ added line',
  '- removed line',
  'fn main() { let x: i32 = 0x1F; println!("{}", x); }',
  '[section]\nname = "docs"',
].join('\n');

const codeBlock = (classes: string[], text = SAMPLE): Root => ({
  type: 'root',
  children: [
    {
      type: 'element',
      tagName: 'pre',
      properties: {},
      children: [{ type: 'element', tagName: 'code', properties: { className: classes }, children: [{ type: 'text', value: text }] }],
    },
  ],
});

const withRehypeHighlight = (tree: Root) => {
  // rehype-highlight reports unknown languages on the file; nothing reads it here.
  rehypeHighlight()(tree, { message: () => undefined } as never);
  return tree;
};
const withReaderHighlight = (tree: Root, grammars: Readonly<Record<string, LanguageFn>>) => {
  rehypeReaderHighlight({ grammars })(tree);
  return tree;
};

const allGrammars = async (): Promise<Record<string, LanguageFn>> => {
  const lazy = await Promise.all(Object.keys(LAZY_HIGHLIGHT_LANGUAGES).map((name) => loadHighlightGrammars(name as LazyHighlightLanguage)));
  return Object.assign({ ...CORE_HIGHLIGHT_GRAMMARS }, ...lazy);
};

describe('rehypeReaderHighlight', () => {
  it.each(Object.keys(common))('highlights %s as rehype-highlight did, with its grammars loaded', async (name) => {
    const grammars = await allGrammars();
    expect(withReaderHighlight(codeBlock([`language-${name}`]), grammars)).toEqual(withRehypeHighlight(codeBlock([`language-${name}`])));
  });

  it('reads aliases and `lang-` classes, and skips `no-highlight`, as rehype-highlight did', async () => {
    const grammars = await allGrammars();
    for (const classes of [['language-ts'], ['lang-py'], ['language-html', 'extra'], ['no-highlight', 'language-js'], ['other'], []]) {
      expect(withReaderHighlight(codeBlock(classes), grammars)).toEqual(withRehypeHighlight(codeBlock(classes)));
    }
  });

  it.each(Object.keys(CORE_HIGHLIGHT_GRAMMARS))('highlights %s with only the core grammars', (name) => {
    // YAML hands ERB tags to Ruby, which `lazyHighlightLanguages` loads when a YAML block has one.
    const text = name === 'yaml' ? SAMPLE.replaceAll('<%= @user.name %>', '') : SAMPLE;
    expect(withReaderHighlight(codeBlock([`language-${name}`], text), CORE_HIGHLIGHT_GRAMMARS)).toEqual(
      withRehypeHighlight(codeBlock([`language-${name}`], text)),
    );
  });

  it('leaves a block in a language whose grammar is not loaded plain, marked as rehype-highlight marks unknown languages', () => {
    const tree = withReaderHighlight(codeBlock(['language-rust'], 'fn main() {}'), CORE_HIGHLIGHT_GRAMMARS);
    const code = (tree.children[0] as Element).children[0] as Element;
    expect(code.properties.className).toEqual(['hljs', 'language-rust']);
    expect(code.children).toEqual([{ type: 'text', value: 'fn main() {}' }]);
  });

  it('only highlights code inside pre, like rehype-highlight', async () => {
    const grammars = await allGrammars();
    const inline = (): Root => ({
      type: 'root',
      children: [
        {
          type: 'element',
          tagName: 'p',
          properties: {},
          children: [{ type: 'element', tagName: 'code', properties: { className: ['language-js'] }, children: [{ type: 'text', value: 'let a' }] }],
        },
      ],
    });
    expect(withReaderHighlight(inline(), grammars)).toEqual(withRehypeHighlight(inline()));
  });
});
