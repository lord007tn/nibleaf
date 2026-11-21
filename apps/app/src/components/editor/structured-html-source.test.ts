// @vitest-environment jsdom
import { Editor } from '@tiptap/core';
import { describe, expect, it } from 'vitest';
import { buildEditorExtensions, getMarkdown } from './tiptap-editor';

describe.each(['Keep', 'النص'])('structured HTML source (#575), %s', (text) => {
  it.each([
    ['paragraph', `<p align='center'>${text}</p>`],
    ['link', `<a href="/x" target="_blank" rel="nofollow" class="btn">${text}</a>`],
    ['heading', `<h2 id="anchor">${text}</h2>`],
    ['list', `<ul class="jump"><li>${text}</li></ul>`],
    ['code block', `<pre class="source"><code>${text}</code></pre>`],
    ['blockquote', `<blockquote dir="rtl"><p>${text}</p></blockquote>`],
  ])('round trips an attributed %s for three saves', (_shape, source) => {
    let saved = source;
    for (let cycle = 0; cycle < 3; cycle++) {
      const editor = new Editor({ element: document.createElement('div'), extensions: buildEditorExtensions() });
      try {
        editor.commands.setContent(saved, { emitUpdate: false });
        saved = getMarkdown(editor);
        expect(saved, `cycle ${cycle + 1}`).toBe(source);
      } finally {
        editor.destroy();
      }
    }
  });

  it('keeps alignment when the structured paragraph is edited', () => {
    const editor = new Editor({ element: document.createElement('div'), extensions: buildEditorExtensions() });
    try {
      editor.commands.setContent(`<p align='right'>${text}</p>`, { emitUpdate: false });
      expect(editor.state.doc.firstChild?.type.name).toBe('paragraph');
      editor.commands.setTextSelection(2);
      expect(editor.commands.insertContent('!')).toBe(true);
      expect(getMarkdown(editor)).toBe(`<p align='right'>${text[0]}!${text.slice(1)}</p>`);
    } finally {
      editor.destroy();
    }
  });

  it('changes a link destination and keeps the other authored attributes', () => {
    const editor = new Editor({ element: document.createElement('div'), extensions: buildEditorExtensions() });
    try {
      editor.commands.setContent(`<a href='/x' target="_blank" rel="nofollow" class="btn">${text}</a>`, { emitUpdate: false });
      editor.commands.setTextSelection(2);
      expect(editor.chain().extendMarkRange('link').updateAttributes('link', { href: '/new?a=1&b=2' }).run()).toBe(true);
      expect(getMarkdown(editor)).toBe(`<a href="/new?a=1&amp;b=2" target="_blank" rel="nofollow" class="btn">${text}</a>`);
    } finally {
      editor.destroy();
    }
  });

  it('keeps nested attributes when the parent text changes', () => {
    const editor = new Editor({ element: document.createElement('div'), extensions: buildEditorExtensions() });
    try {
      editor.commands.setContent(`<p align='right'>${text} <a href="/x" class="btn">Link</a></p>`, { emitUpdate: false });
      editor.commands.setTextSelection(2);
      expect(editor.commands.insertContent('!')).toBe(true);
      expect(getMarkdown(editor)).toContain(`<p align='right'>${text[0]}!${text.slice(1)} <a `);
      expect(getMarkdown(editor)).toContain('class="btn"');
    } finally {
      editor.destroy();
    }
  });

  it('keeps the list class when the ordered list start changes', () => {
    const editor = new Editor({ element: document.createElement('div'), extensions: buildEditorExtensions() });
    try {
      editor.commands.setContent(`<ol class="chapters" start='3'><li>${text}</li></ol>`, { emitUpdate: false });
      editor.commands.setTextSelection(3);
      expect(editor.commands.updateAttributes('orderedList', { start: 7 })).toBe(true);
      expect(getMarkdown(editor)).toBe(`<ol class="chapters" start="7"><li>${text}</li></ol>`);
    } finally {
      editor.destroy();
    }
  });

  it('keeps safe parent attributes without replaying a discarded link', () => {
    const editor = new Editor({ element: document.createElement('div'), extensions: buildEditorExtensions() });
    try {
      editor.commands.setContent(`<p align='right'>${text} <a href="javascript:void(0)">Link</a></p>`, { emitUpdate: false });
      expect(getMarkdown(editor)).toBe(`<p align='right'>${text} Link</p>`);
    } finally {
      editor.destroy();
    }
  });
});
