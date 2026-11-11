// @vitest-environment jsdom
import { readFileSync } from 'node:fs';
import { Editor } from '@tiptap/core';
import type { Node as PMNode } from '@tiptap/pm/model';
import { afterEach, describe, expect, it } from 'vitest';
import { buildEditorExtensions, getMarkdown } from '../tiptap-editor';
import { cleanPastedHTML } from './clean-paste';

const editors: Editor[] = [];
const fixture = (name: string) => readFileSync(`src/components/editor/__fixtures__/${name}.html`, 'utf8');
function editor() {
  const instance = new Editor({ element: document.createElement('div'), extensions: buildEditorExtensions() });
  editors.push(instance);
  return instance;
}
afterEach(() => {
  for (const instance of editors.splice(0)) instance.destroy();
});

function tree(node: PMNode): unknown {
  if (node.isText) return { text: node.text, marks: node.marks.map((mark) => mark.type.name) };
  return { type: node.type.name, children: node.content.content.map(tree) };
}
const text = (value: string, marks: string[] = []) => ({ text: value, marks });
const node = (type: string, ...children: unknown[]) => ({ type, children });
const paragraph = (...children: unknown[]) => node('paragraph', ...children);

describe('writer clipboard fixtures', () => {
  it.each(['google-docs.reconstructed', 'notion.reconstructed'])('preserves the entire nested tree and marks from %s without gaps', (name) => {
    const instance = editor();
    instance.view.pasteHTML(fixture(name), new Event('paste') as ClipboardEvent);
    expect(tree(instance.state.doc)).toEqual(
      node(
        'doc',
        node('heading', text('Moving a document', name === 'google-docs.reconstructed' ? ['bold'] : [])),
        node(
          'bulletList',
          node('listItem', paragraph(text('First item'))),
          node(
            'listItem',
            paragraph(text('Second item')),
            node(
              'bulletList',
              node(
                'listItem',
                paragraph(text('Nested item', ['bold']), text(' with '), text('emphasis', ['italic'])),
                node('orderedList', node('listItem', paragraph(text('Deep link', ['link'])))),
              ),
            ),
          ),
          node('listItem', paragraph(text('Third item'))),
        ),
        node(
          'orderedList',
          node('listItem', paragraph(text('Numbered item')), node('orderedList', node('listItem', paragraph(text('Numbered child'))))),
          node('listItem', paragraph(text('Next number'))),
        ),
        paragraph(),
      ),
    );
    expect(instance.state.doc.child(2).attrs.start).toBe(4);
    const markdown = getMarkdown(instance);
    expect(markdown).toContain('- Second item\n  - **Nested item** with *emphasis*\n    3. [Deep link](https://example.com/guide)\n- Third item');
    expect(markdown).not.toContain('\n\n  ');
    const html = cleanPastedHTML(fixture(name));
    expect(html).not.toMatch(/style=|<span|<div|docs-internal|<a(?:\s[^>]*)?><\/a>|<br/);
  });

  it('preserves mixed document blocks, marks, text and task state', () => {
    const instance = editor();
    instance.view.pasteHTML(fixture('mixed-document.reconstructed'), new Event('paste') as ClipboardEvent);
    const doc = instance.state.doc;
    expect(doc.content.content.map((child) => child.type.name)).toEqual([
      'heading',
      'paragraph',
      'bulletList',
      'blockquote',
      'codeBlock',
      'table',
      'taskList',
      'paragraph',
    ]);
    expect(doc.child(0).attrs.level).toBe(1);
    expect(tree(doc.child(1))).toEqual(
      paragraph(
        text('Plain text, '),
        text('bold', ['bold']),
        text(', '),
        text('italic', ['italic']),
        text(', '),
        text('help', ['link']),
        text(' and '),
        text('inline()', ['code']),
        text('.'),
      ),
    );
    expect(doc.child(1).child(5).marks[0]?.attrs.href).toBe('/help');
    expect(doc.child(4).attrs.language).toBe('typescript');
    expect(doc.child(4).textContent).toBe("const greeting = 'hello';\nconsole.log(greeting);");
    expect(doc.child(5).childCount).toBe(2);
    expect(doc.child(6).firstChild?.attrs.checked).toBe(true);
    expect(doc.child(6).firstChild?.lastChild?.firstChild?.attrs.checked).toBe(false);
    expect(doc.lastChild?.textContent).toBe('العربية تبقى كما هي. End.');
    doc.descendants((child) => {
      if (child.type.name === 'paragraph') expect(child.content.size).toBeGreaterThan(0);
    });
    expect(getMarkdown(instance)).toContain('- Second item\n  - Nested item');
  });

  it.each([
    ['plain text', 'First line\nSecond line', 'First line\\\nSecond line'],
    [
      'Markdown',
      '## Heading\n\n- First\n- Second\n  - **Nested**\n\n[Help](/help)',
      '## Heading\n\n- First\n- Second\n  - **Nested**\n\n[Help](/help)',
    ],
  ])('keeps the existing %s paste path', (_name, source, expected) => {
    const instance = editor();
    instance.view.dom.dispatchEvent(
      Object.assign(new Event('paste', { bubbles: true, cancelable: true }), {
        clipboardData: { getData: (type: string) => (type === 'text/plain' ? source : ''), files: [] },
      }),
    );
    expect(getMarkdown(instance)).toBe(expected);
  });

  it('keeps paste-as-plain-text literal, including Markdown punctuation', () => {
    const instance = editor();
    instance.view.pasteText('## Literal\n- item', new Event('paste') as ClipboardEvent);
    expect(tree(instance.state.doc)).toEqual(node('doc', paragraph(text('## Literal')), paragraph(text('- item'))));
  });

  it('keeps deliberate paragraphs and inline line breaks within a list item', () => {
    const instance = editor();
    instance.view.pasteHTML(
      '<ul><li><p>First<br>continued</p><p>Second paragraph</p><ul><li>Child</li></ul></li></ul>',
      new Event('paste') as ClipboardEvent,
    );
    expect(tree(instance.state.doc.firstChild?.firstChild as PMNode)).toEqual(
      node(
        'listItem',
        paragraph(text('First'), node('hardBreak'), text('continued')),
        paragraph(text('Second paragraph')),
        node('bulletList', node('listItem', paragraph(text('Child')))),
      ),
    );
  });

  it('keeps inline breaks when the list item has no paragraph wrapper', () => {
    const instance = editor();
    instance.view.pasteHTML('<ul><li>First<br>continued</li></ul>', new Event('paste') as ClipboardEvent);
    expect(tree(instance.state.doc.firstChild?.firstChild as PMNode)).toEqual(
      node('listItem', paragraph(text('First'), node('hardBreak'), text('continued'))),
    );
  });

  it('removes a run of filler breaks before a nested list without dropping inline text', () => {
    const instance = editor();
    instance.view.pasteHTML('<ul><li>Parent<br> <br>\n<ul><li>Child</li></ul></li></ul>', new Event('paste') as ClipboardEvent);
    expect(tree(instance.state.doc.firstChild?.firstChild as PMNode)).toEqual(
      node('listItem', paragraph(text('Parent')), node('bulletList', node('listItem', paragraph(text('Child'))))),
    );
  });
});
