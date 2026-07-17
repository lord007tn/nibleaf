// @vitest-environment jsdom
/**
 * Markdown round-trip stability for the WYSIWYG editor.
 *
 * Content is Markdown end-to-end (the DB, search, TOC and the live site all
 * consume the Markdown string) — the editor must NEVER lose information when a
 * document is loaded and saved. These tests run `markdown → doc → markdown`
 * against the EXACT extension set the app ships (buildEditorExtensions) and
 * assert the output is stable, including after programmatic edits (link URL
 * change, code-block language switch) that the new UI performs.
 */
import { Editor } from '@tiptap/core';
import TextAlign from '@tiptap/extension-text-align';
import { afterAll, describe, expect, it } from 'vitest';
import { buildEditorExtensions, getMarkdown } from './tiptap-editor';

const editor = new Editor({ element: document.createElement('div'), extensions: buildEditorExtensions() });

/** Parse markdown into the editor and serialize it back. */
const roundTrip = (markdown: string): string => {
  editor.commands.setContent(markdown, { emitUpdate: false });
  return getMarkdown(editor);
};

/** Assert `markdown → doc → markdown` reaches a fixed point, and return it. */
const expectStable = (markdown: string): string => {
  const once = roundTrip(markdown);
  const twice = roundTrip(once);
  expect(twice).toBe(once);
  return once;
};

afterAll(() => {
  editor.destroy();
});

describe('markdown round-trip stability', () => {
  it('preserves links', () => {
    const output = expectStable('Visit [Docs](https://example.com/docs) now.');
    expect(output).toContain('[Docs](https://example.com/docs)');
  });

  it('preserves a link URL edit (the link popover flow)', () => {
    editor.commands.setContent('Visit [Docs](https://old.example.com) now.', { emitUpdate: false });
    // Caret inside the link text ("Docs" spans positions 7–11), like a user clicking into it.
    editor.commands.setTextSelection(9);
    editor.chain().extendMarkRange('link').setLink({ href: 'https://new.example.com' }).run();
    const output = getMarkdown(editor);
    expect(output).toContain('[Docs](https://new.example.com)');
    expect(output).not.toContain('old.example.com');
    expect(roundTrip(output)).toBe(output);
  });

  it('preserves tables', () => {
    const output = expectStable('| Name | Role |\n| --- | --- |\n| Amira | Admin |\n| Ziad | Viewer |');
    expect(output).toContain('| Name | Role |');
    expect(output).toContain('| Amira | Admin |');
  });

  it('preserves code blocks with a language fence', () => {
    const output = expectStable('```typescript\nconst x: number = 1;\n```');
    expect(output).toContain('```typescript');
    expect(output).toContain('const x: number = 1;');
  });

  it('preserves a code-block language switch (the language select flow)', () => {
    editor.commands.setContent('```javascript\nconsole.log(1)\n```', { emitUpdate: false });
    editor.commands.selectAll();
    editor.commands.updateAttributes('codeBlock', { language: 'python' });
    const output = getMarkdown(editor);
    expect(output).toContain('```python');
    expect(roundTrip(output)).toBe(output);
  });

  it('preserves task lists', () => {
    const output = expectStable('- [ ] Draft the intro\n- [x] Ship the fix');
    expect(output).toContain('- [ ] Draft the intro');
    expect(output).toContain('- [x] Ship the fix');
  });

  it('preserves subscript and superscript as inline HTML (toolbar buttons rely on this)', () => {
    const output = expectStable('H<sub>2</sub>O and E=mc<sup>2</sup>');
    expect(output).toContain('<sub>2</sub>');
    expect(output).toContain('<sup>2</sup>');
  });

  it('preserves highlight and underline as inline HTML', () => {
    const output = expectStable('A <mark>key</mark> and <u>underlined</u> point.');
    expect(output).toContain('<mark>key</mark>');
    expect(output).toContain('<u>underlined</u>');
  });
});

describe('text alignment (why the align buttons were removed)', () => {
  it('drops textAlign on serialization — alignment cannot survive Markdown', () => {
    const aligned = new Editor({
      element: document.createElement('div'),
      extensions: [...buildEditorExtensions(), TextAlign.configure({ types: ['heading', 'paragraph'] })],
    });
    try {
      aligned.commands.setContent('Hello world', { emitUpdate: false });
      aligned.commands.selectAll();
      aligned.commands.setTextAlign('center');
      // The attr is applied in the doc…
      expect(aligned.getAttributes('paragraph').textAlign).toBe('center');
      // …but serializing to Markdown silently discards it. This is why the
      // toolbar no longer offers alignment buttons (see DocumentToolbar).
      const storage = aligned.storage as { markdown?: { getMarkdown(): string } };
      const output = storage.markdown?.getMarkdown() ?? '';
      expect(output).toBe('Hello world');
      expect(output).not.toContain('text-align');
    } finally {
      aligned.destroy();
    }
  });
});
