import type { Element, ElementContent, Root } from 'hast';
import { toText } from 'hast-util-to-text';
import type { LanguageFn } from 'highlight.js';
import bash from 'highlight.js/lib/languages/bash';
import css from 'highlight.js/lib/languages/css';
import diff from 'highlight.js/lib/languages/diff';
import graphql from 'highlight.js/lib/languages/graphql';
import javascript from 'highlight.js/lib/languages/javascript';
import json from 'highlight.js/lib/languages/json';
import markdown from 'highlight.js/lib/languages/markdown';
import plaintext from 'highlight.js/lib/languages/plaintext';
import python from 'highlight.js/lib/languages/python';
import shell from 'highlight.js/lib/languages/shell';
import sql from 'highlight.js/lib/languages/sql';
import typescript from 'highlight.js/lib/languages/typescript';
import xml from 'highlight.js/lib/languages/xml';
import yaml from 'highlight.js/lib/languages/yaml';
import { createLowlight } from 'lowlight';

/**
 * Grammars every article renderer registers: the languages most docs use, and
 * the ones they embed (JavaScript and TypeScript highlight GraphQL templates,
 * HTML its CSS and scripts). The rest of lowlight's `common` set loads per
 * language (lib/highlight-languages.ts).
 */
export const CORE_HIGHLIGHT_GRAMMARS: Readonly<Record<string, LanguageFn>> = {
  bash,
  css,
  diff,
  graphql,
  javascript,
  json,
  markdown,
  plaintext,
  python,
  shell,
  sql,
  typescript,
  xml,
  yaml,
};

/** A fenced block's language from its classes, as rehype-highlight reads it:
 *  `false` for `no-highlight`, `undefined` for none. */
function codeLanguage(node: Element): string | false | undefined {
  const list = node.properties.className;
  if (!Array.isArray(list)) return undefined;
  let name: string | undefined;
  for (const item of list) {
    const value = String(item);
    if (value === 'no-highlight' || value === 'nohighlight') return false;
    if (!name && value.slice(0, 5) === 'lang-') name = value.slice(5);
    if (!name && value.slice(0, 9) === 'language-') name = value.slice(9);
  }
  return name;
}

/**
 * rehype-highlight's output for code with a language class, with only the
 * grammars given (core grammars plus any loaded for this article). A block in a
 * language that isn't registered stays plain, as rehype-highlight leaves it.
 * rehype-highlight itself imports every `common` grammar.
 */
/** Characters per code block above which it renders as plain text. */
export const MAX_HIGHLIGHT_LENGTH = 50_000;

export function rehypeReaderHighlight({ grammars }: { grammars: Readonly<Record<string, LanguageFn>> }) {
  const lowlight = createLowlight(grammars);
  // Every `code` element directly inside a `pre`, in document order.
  const visit = (node: Root | Element) => {
    for (const child of node.children) {
      if (child.type !== 'element') continue;
      if (child.tagName === 'code' && node.type === 'element' && node.tagName === 'pre') highlight(child);
      visit(child);
    }
  };
  const highlight = (node: Element) => {
    const language = codeLanguage(node);
    if (!language) return;
    if (!Array.isArray(node.properties.className)) node.properties.className = [];
    if (!node.properties.className.includes('hljs')) node.properties.className.unshift('hljs');
    if (!lowlight.registered(language)) return;
    const text = toText(node, { whitespace: 'pre' });
    // A huge block (a pasted log or bundle) stays plain text: highlighting it
    // costs the render far more than the colours are worth.
    if (text.length > MAX_HIGHLIGHT_LENGTH) return;
    const result = lowlight.highlight(language, text);
    if (result.children.length > 0) node.children = result.children as ElementContent[];
  };
  return (tree: Root) => {
    visit(tree);
  };
}
