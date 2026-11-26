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

// These nested items were moved out of their list on main, and a save turned `Top` into a
// heading (#843). With list item leads (#604, #865) the quote stays in its item.
describe('nested items led by a quote', () => {
  it.each([
    ['- Top\n  - > Alpha', '- Top\n  - > Alpha'],
    ['- Top\n  - > Alpha\n  - Beta', '- Top\n  - > Alpha\n  - Beta'],
    ['- Top\n  - > Alpha\n\n  - Beta', '- Top\n  - > Alpha\n\n  - Beta'],
    // A line of spaces only is written as an empty line.
    ['- Top\n  - > Alpha\n    - Beta\n  \n    - Gamma\n  - Delta', '- Top\n  - > Alpha\n    - Beta\n\n    - Gamma\n  - Delta'],
  ])('saves %j as written, and the reader shows it as the source, Top not a heading', (source, written) => {
    const saved = save(source);
    expect(saved).toBe(written);
    expect(save(saved)).toBe(saved);
    const render = (content: string) => renderToStaticMarkup(createElement(MarkdownRenderer, { content }));
    expect(render(saved)).toBe(render(source));
    expect(render(saved)).not.toContain('<h2');
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
