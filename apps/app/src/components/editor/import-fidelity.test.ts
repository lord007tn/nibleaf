// @vitest-environment jsdom
import { Editor } from '@tiptap/core';
import { describe, expect, it } from 'vitest';
import { convertGitBookMarkdown } from '../../../../server/src/actions/importers/gitbook-markdown';
import { rewriteMintlifyInternalLinks } from '../../../../server/src/actions/importers/mintlify-links';
import { normalizeMintlifyMdx } from '../../../../server/src/actions/importers/mintlify-mdx';
import { buildEditorExtensions, getMarkdown } from './tiptap-editor';

describe('import fidelity through the real editor extensions', () => {
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
