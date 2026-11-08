// @vitest-environment jsdom
import { Editor } from '@tiptap/core';
import { afterEach, describe, expect, it } from 'vitest';
import { buildEditorExtensions, getMarkdown } from '../tiptap-editor';
import { findUnsupportedMdxComponents } from './mdx-roundtrip';

const editors: Editor[] = [];
const load = (source: string) => {
  const editor = new Editor({ element: document.createElement('div'), extensions: buildEditorExtensions() });
  editors.push(editor);
  editor.commands.setContent(source, { emitUpdate: false });
  return editor;
};
/** Load, save, reload and save again: the second save must match the first. */
const roundTrip = (source: string) => {
  const saved = getMarkdown(load(source));
  expect(getMarkdown(load(saved))).toBe(saved);
  return saved;
};
afterEach(() => {
  for (const editor of editors.splice(0)) editor.destroy();
});

describe('authored uppercase <IMG> tags', () => {
  it('apply the image allow-list and save as <img>', () => {
    const editor = load('<IMG src="https://example.com/a.png" alt="Diagram" width="320" onerror="alert(1)" style="color:red" data-x="1" />');
    expect(editor.state.doc.firstChild?.type.name).toBe('image');
    expect(editor.state.doc.firstChild?.attrs).toMatchObject({ src: 'https://example.com/a.png', alt: 'Diagram', width: 320 });
    const saved = roundTrip('<IMG src="https://example.com/a.png" alt="Diagram" width="320" onerror="alert(1)" style="color:red" data-x="1" />');
    expect(saved).toBe('<img src="https://example.com/a.png" alt="Diagram" width="320" />');
  });

  it('normalise an inline <IMG> inside a paragraph and drop a stray </IMG>', () => {
    const saved = roundTrip('Before <IMG SRC="https://example.com/i.png" ALT="Icon" ONERROR="x"></IMG> after');
    expect(saved).not.toMatch(/IMG|onerror|ONERROR/);
    expect(saved).toContain('https://example.com/i.png');
    expect(saved).toContain('Before');
    expect(saved).toContain('after');
  });

  it('keep an inline base64 <IMG> visible as a kept inline image, without its handlers', () => {
    const editor = load('<IMG src="data:image/png;base64,iVBORw0KGgo=" alt="Old" onerror="alert(1)" />');
    expect(editor.state.doc.firstChild?.type.name).toBe('legacyImage');
    const saved = getMarkdown(editor);
    expect(saved).toBe('<img src="data:image/png;base64,iVBORw0KGgo=" alt="Old" />');
  });

  it('are not listed as unsupported components', () => {
    expect(findUnsupportedMdxComponents('<IMG src="https://example.com/a.png" />\n\n<Widget />')).toEqual(['Widget']);
  });

  it('leave real components and code alone', () => {
    const component = '<Img src="https://example.com/a.png" onerror="kept" />';
    expect(roundTrip(component)).toBe(component);
    const code = '```html\n<IMG src="https://example.com/a.png" onerror="kept" />\n```';
    expect(roundTrip(code)).toBe(code);
    const span = 'Use `<IMG onerror="x">` literally';
    expect(roundTrip(span)).toBe(span);
  });
});
