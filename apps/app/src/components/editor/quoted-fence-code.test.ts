// @vitest-environment jsdom
import { normalizePublicMarkdownContent, portablePublicMdxMarkdown } from '@nibleaf/shared/public-markdown-content';
import { normalizeMdxBlocks } from '@nibleaf/shared/reader-markdown';
import { Editor } from '@tiptap/core';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import ReactMarkdown from 'react-markdown';
import { describe, expect, it } from 'vitest';
import { buildEditorExtensions, getMarkdown } from './tiptap-editor';

const fenced = (opener: string, body: string): string => `${opener}\`\`\`js\n${body}const a = 1;\n${opener}\`\`\``;

function readerCode(markdown: string): string | undefined {
  const view = document.createElement('div');
  view.innerHTML = renderToStaticMarkup(createElement(ReactMarkdown, null, normalizeMdxBlocks(markdown)));
  return view.querySelector('pre > code')?.textContent?.replace(/\n$/, '');
}

describe('quoted fence code text (#607)', () => {
  it.each([
    ['>\t', '>\t', 'const a = 1;'],
    ['> \t', '> \t', 'const a = 1;'],
    ['>\t\t', '>\t\t', '  ```js\n  const a = 1;\n  ```'],
    ['> >\t', '> >\t', 'const a = 1;'],
    ['> ', '>\t', '  const a = 1;'],
    ['> ', '>\t\t', '  \tconst a = 1;'],
  ])('agrees with the reader and Markdown exports for opener %j and body %j', (opener, body, expected) => {
    const source = fenced(opener, body);
    expect(readerCode(source)).toBe(expected);
    expect(readerCode(normalizePublicMarkdownContent(source))).toBe(expected);
    expect(readerCode(portablePublicMdxMarkdown(source))).toBe(expected);

    const editor = new Editor({ element: document.createElement('div'), extensions: buildEditorExtensions() });
    try {
      editor.commands.setContent(source, { emitUpdate: false });
      const blocks: string[] = [];
      editor.state.doc.descendants((node) => {
        if (node.type.name === 'codeBlock') blocks.push(node.textContent);
      });
      expect(blocks).toEqual([expected]);
      const saved = getMarkdown(editor);
      expect(readerCode(saved)).toBe(expected);
      if (opener === '> ' && body.startsWith('>\t')) expect(saved).toBe(source);
    } finally {
      editor.destroy();
    }
  });
});
