// @vitest-environment jsdom
import { Editor } from '@tiptap/core';
import { describe, expect, it } from 'vitest';
import { convertGitBookMarkdown } from '../../../../server/src/actions/importers/gitbook-markdown';
import { rewriteMintlifyInternalLinks } from '../../../../server/src/actions/importers/mintlify-links';
import { normalizeMintlifyMdx } from '../../../../server/src/actions/importers/mintlify-mdx';
import { buildEditorExtensions, getMarkdown } from './tiptap-editor';

describe('import fidelity through the real editor extensions', () => {
  it('council P2 containers: imported videos round-trip inside lists, nested lists and blockquotes', () => {
    for (const source of [
      '- Step one\n\n  [Demo](https://youtu.be/abcdefghijk)\n\n  Finish.',
      '- Outer\n\n  - Step one\n\n    [Demo](https://youtu.be/abcdefghijk)\n\n    Finish.',
      '> Step one\n>\n> [Demo](https://youtu.be/abcdefghijk)\n>\n> Finish.',
    ]) {
      for (const convert of [(text: string) => convertGitBookMarkdown(text, { resolveFile: () => undefined }).content, normalizeMintlifyMdx]) {
        const imported = convert(source);
        const editor = new Editor({ element: document.createElement('div'), extensions: buildEditorExtensions() });
        try {
          editor.commands.setContent(imported, { emitUpdate: false });
          let contained = false;
          editor.state.doc.descendants((node) => {
            if (node.type.name !== (source.startsWith('>') ? 'blockquote' : 'listItem')) return;
            const children: string[] = [];
            node.forEach((child) => {
              children.push(child.type.name);
            });
            let video = children.includes('videoEmbed');
            // The editor deliberately keeps raw HTML in quotes through its
            // opaque inline path; its iframe must still stay inside the quote.
            if (source.startsWith('>'))
              node.descendants((child) => {
                if (child.type.name === 'mdxOpaqueInline' && String(child.attrs.source).includes('<iframe src=')) video = true;
              });
            if (video && node.textContent.includes('Finish.')) contained = true;
          });
          expect(contained, JSON.stringify({ source, imported, doc: editor.state.doc.toJSON() })).toBe(true);
          const saved = getMarkdown(editor);
          editor.commands.setContent(saved, { emitUpdate: false });
          expect(getMarkdown(editor)).toBe(saved);
          expect(editor.state.doc.textContent).toContain('Finish.');
        } finally {
          editor.destroy();
        }
      }
    }
  });
  it.each(['en', 'ar'])('saves imported video, divider and page links byte for byte (%s)', (lang) => {
    const title = lang === 'ar' ? 'فيديو الشرح:' : 'Video tour:';
    const body = `${title}\n\n<iframe src="https://youtu.be/abcdefghijk" title="${title}"></iframe>\n\n/\n\n<p>---</p>\n\n[Next](https://nibleaf.com/pages/next?lang=${lang}#start)`;
    for (const convert of [(source: string) => convertGitBookMarkdown(source, { resolveFile: () => undefined }).content, normalizeMintlifyMdx]) {
      const imported = rewriteMintlifyInternalLinks(convert(body), 'intro', new Map([['next', '/next']]));
      const editor = new Editor({
        element: document.createElement('div'),
        extensions: buildEditorExtensions({ dir: lang === 'ar' ? 'rtl' : 'ltr' }),
      });
      try {
        editor.commands.setContent(imported, { emitUpdate: false });
        expect(getMarkdown(editor)).toBe(imported);
        editor.commands.setContent(getMarkdown(editor), { emitUpdate: false });
        expect(getMarkdown(editor)).toBe(imported);
        expect(editor.state.doc.toJSON().content?.some((node: { type: string }) => node.type === 'horizontalRule')).toBe(true);
      } finally {
        editor.destroy();
      }
    }
  });
});
