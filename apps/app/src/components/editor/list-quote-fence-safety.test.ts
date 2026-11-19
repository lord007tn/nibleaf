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

describe('quote-led nested items (#604, #865)', () => {
  // Four named exceptions to main's lossy bytes: quote only, tight sibling,
  // loose sibling, and nested loose list. Keep the source's reader structure.
  it.each([
    ['- Top\n  - > Alpha', '- Top\n  - > Alpha'],
    ['- Top\n  - > Alpha\n  - Beta', '- Top\n  - > Alpha\n  - Beta'],
    ['- Top\n  - > Alpha\n\n  - Beta', '- Top\n  - > Alpha\n\n  - Beta'],
    ['- Top\n  - > Alpha\n    - Beta\n  \n    - Gamma\n  - Delta', '- Top\n  - > Alpha\n    - Beta\n\n    - Gamma\n  - Delta'],
  ])('keeps the nested quote and reader structure for %j', (source, expected) => {
    let saved = source;
    for (let cycle = 0; cycle < 4; cycle++) {
      saved = save(saved);
      expect(saved).toBe(expected);
    }
    const html = renderToStaticMarkup(createElement(MarkdownRenderer, { content: saved }));
    expect(html).toBe(renderToStaticMarkup(createElement(MarkdownRenderer, { content: source })));
    const reader = document.createElement('div');
    reader.innerHTML = html;
    expect(reader.querySelector('li > ul > li > blockquote')?.textContent).toContain('Alpha');
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
