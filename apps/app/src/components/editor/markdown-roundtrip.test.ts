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

describe('block boundaries after images', () => {
  const cards = [
    '<CardGroup cols="2">',
    '<Card title="One" href="/one">',
    '![One](https://example.com/one.png)',
    '</Card>',
    '<Card title="Two" href="/two">',
    '![Two](https://example.com/two.png)',
    '</Card>',
    '</CardGroup>',
  ].join('\n\n');

  it('keeps a closing tag after a trailing image on its own line', () => {
    const output = expectStable(cards);
    expect(output).toContain('![One](https://example.com/one.png)\n\n</Card>\n\n<Card title="Two" href="/two">');
    expect(output).toContain('![Two](https://example.com/two.png)\n\n</Card>\n\n</CardGroup>');
  });

  it('keeps an opening tag after an image on its own line', () => {
    const output = expectStable('![](https://example.com/banner.png)\n\n<Check>\n\n**Done**\n\n</Check>');
    expect(output).toContain('![](https://example.com/banner.png)\n\n<Check>\n\n**Done**\n\n</Check>');
  });

  it('keeps a paragraph after an image separate', () => {
    const output = expectStable('![](https://example.com/a.png)\n\nNext paragraph.');
    expect(output).toBe('![](https://example.com/a.png)\n\nNext paragraph.');
  });

  const after = { type: 'paragraph', content: [{ type: 'text', text: 'After.' }] };

  it('keeps parentheses, quotes and a trailing backslash in image titles', () => {
    const attrs = { src: 'https://example.com/a(1).png', alt: 'Diagram', title: 'Say "hi" \\' };
    editor.commands.setContent({ type: 'doc', content: [{ type: 'image', attrs }, after] }, { emitUpdate: false });
    const markdown = getMarkdown(editor);

    expect(expectStable(markdown)).toBe(markdown);
    editor.commands.setContent(markdown, { emitUpdate: false });
    expect(editor.getJSON().content?.find((node) => node.type === 'image')?.attrs).toMatchObject(attrs);
  });

  it('does not let a trailing backslash in an image source swallow its closing parenthesis', () => {
    const image = { type: 'image', attrs: { src: 'https://example.com/a\\', alt: 'A' } };
    editor.commands.setContent({ type: 'doc', content: [image, after] }, { emitUpdate: false });

    const output = expectStable(getMarkdown(editor));
    editor.commands.setContent(output, { emitUpdate: false });
    expect(editor.getJSON().content?.map((node) => node.type)).toEqual(['image', 'paragraph']);
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
