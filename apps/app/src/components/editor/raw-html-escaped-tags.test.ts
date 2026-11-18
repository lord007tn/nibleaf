// @vitest-environment jsdom
import { Editor } from '@tiptap/core';
import { describe, expect, it } from 'vitest';
import { buildEditorExtensions, getMarkdown } from './tiptap-editor';

const languages = [
  ['EN', 'Intro with', 'literal', 'Editable.'],
  ['AR', 'مقدمة مع', 'نص', 'قابل للتحرير.'],
] as const;

function inspect(source: string) {
  const editor = new Editor({ element: document.createElement('div'), extensions: buildEditorExtensions() });
  try {
    editor.commands.setContent(source, { emitUpdate: false });
    const callouts: string[] = [];
    const opaque: string[] = [];
    editor.state.doc.descendants((node) => {
      if (node.type.name === 'callout') callouts.push(node.textContent);
      if (node.type.name.startsWith('mdxOpaque')) opaque.push(String(node.attrs.source));
    });
    return { saved: getMarkdown(editor), callouts, opaque };
  } finally {
    editor.destroy();
  }
}

describe.each(languages)('escaped raw-text source preservation (#625), %s', (_language, intro, literal, note) => {
  describe.each(['title', 'script', 'style', 'textarea'])('<%s>', (tag) => {
    const after = `\n\n<Note>\n\n${note}\n\n</Note>`;
    it.each([
      ['one backslash', `\\<${tag}>${literal}.`],
      ['three backslashes', `\\\\\\<${tag}>${literal}.`],
      ['a closed pair', `\\<${tag}>${literal}</${tag}>`],
      ['an escaped closer', `\\</${tag}>${literal}.`],
    ])('keeps %s byte for byte on the first save and ten cycles', (_name, body) => {
      const source = `${intro} ${body}${after}`;
      let saved = source;
      for (let cycle = 0; cycle < 10; cycle++) {
        const result = inspect(saved);
        expect(result.saved, `cycle ${cycle + 1}`).toBe(source);
        expect(result.saved).not.toContain('nibleaf-mdx-opaque');
        expect(result.callouts).toEqual([note]);
        saved = result.saved;
      }
    });

    it('still treats two backslashes as an escaped backslash followed by a real raw-text tag', () => {
      const raw = `<${tag}>${literal}.${after}`;
      const result = inspect(`${intro} \\\\${raw}`);
      expect(result.opaque).toEqual([raw]);
      expect(result.callouts).toEqual([]);
      expect(inspect(result.saved).saved).toBe(result.saved);
    });

    it('leaves tags in inline code as code and keeps the following component editable', () => {
      const source = `${intro} \`<${tag}>\` ${literal}.${after}`;
      let saved = source;
      for (let cycle = 0; cycle < 10; cycle++) {
        const result = inspect(saved);
        expect(result.saved).toBe(source);
        expect(result.opaque).toEqual([]);
        expect(result.callouts).toEqual([note]);
        saved = result.saved;
      }
    });
  });
});
