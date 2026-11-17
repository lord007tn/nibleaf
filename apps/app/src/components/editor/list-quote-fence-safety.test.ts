// @vitest-environment jsdom
import { Editor } from '@tiptap/core';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { afterAll, describe, expect, it } from 'vitest';
import { MarkdownRenderer } from '../markdown';
import { buildEditorExtensions, getMarkdown } from './tiptap-editor';

const editor = new Editor({ element: document.createElement('div'), extensions: buildEditorExtensions() });
afterAll(() => editor.destroy());

const save = (source: string) => {
  editor.commands.setContent(source, { emitUpdate: false });
  return getMarkdown(editor);
};

describe('nested items that the editor moves out of their list', () => {
  it.each([
    ['- Top\n  - > Alpha', '- Top\n\n  - \n\n  > Alpha'],
    ['- Top\n  - > Alpha\n  - Beta', '- Top\n\n  - \n\n  > Alpha\n\n  - Beta'],
    ['- Top\n  - > Alpha\n\n  - Beta', '- Top\n\n  - \n\n  > Alpha\n\n  - Beta'],
    ['- Top\n  - > Alpha\n    - Beta\n  \n    - Gamma\n  - Delta', '- Top\n\n  - \n\n  > Alpha\n\n  - Beta\n\n  - Gamma\n\n\n  - Delta'],
  ])('keeps main’s saved bytes and reader paragraphs for %j', (source, main) => {
    const saved = save(source);
    expect(saved).toBe(main);
    const html = renderToStaticMarkup(createElement(MarkdownRenderer, { content: saved }));
    expect(html).toContain('<p dir="auto">Top</p>');
    expect(html).not.toContain('<h2');
  });
});

describe('literal quote markers inside unclosed code fences', () => {
  for (const marker of ['~~~', '```', '~~~~~', '````']) {
    it(`keeps an empty unclosed fence before its next list item with ${marker}`, () => {
      const source = `- ${marker}js\n- b`;
      expect(save(source)).toBe(source);
    });

    it.each(['>', '>>', '> >', ' >'])(`keeps %j as code without adding a closer after ${marker}`, (code) => {
      const source = `- ${marker}js\n  ${code}\n- b`;
      let saved = source;
      for (let cycle = 0; cycle < 4; cycle++) {
        saved = save(saved);
        expect(saved).toBe(source);
      }
    });

    it(`keeps literal > after real quote and nested list prefixes with ${marker}`, () => {
      const source = `> - Outer\n>   - ${marker}js\n>     >\n>   - b`;
      expect(save(source)).toBe(source);
    });
  }
});
