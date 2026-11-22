// @vitest-environment jsdom
import { readerHeadings } from '@nibleaf/shared/reader-headings';
import { Editor } from '@tiptap/core';
import { closeHistory } from '@tiptap/pm/history';
import { describe, expect, it } from 'vitest';
import { encodeMdxSource } from './extensions/mdx-roundtrip';
import { buildEditorExtensions, getMarkdown } from './tiptap-editor';

const makeEditor = () => new Editor({ element: document.createElement('div'), extensions: buildEditorExtensions() });

function expectReloads(firstSave: string, text: string): void {
  let saved = firstSave;
  for (let cycle = 2; cycle <= 3; cycle++) {
    const reopened = makeEditor();
    try {
      reopened.commands.setContent(saved, { emitUpdate: false });
      saved = getMarkdown(reopened);
      expect(saved, `save ${cycle}`).toBe(firstSave);
      expect(reopened.state.doc.textContent, `text on save ${cycle}`).toBe(text);
    } finally {
      reopened.destroy();
    }
  }
}

describe.each([
  ['EN', 'GET /users/', 'details', 'id'],
  ['AR', 'المستخدمون', 'التفاصيل', 'س'],
])('typing literal braces in structured HTML (%s)', (_locale, lead, tail, parameter) => {
  it.each([
    ['heading', '<h2 id="get-user">', '</h2>'],
    ['paragraph', '<p align="center">', '</p>'],
    ['link', '<a href="/x" class="btn">', '</a>'],
    ['quote', '<blockquote dir="rtl"><p>', '</p></blockquote>'],
    ['list', '<ul class="steps"><li><p>', '</p></li></ul>'],
  ])('keeps %s source through typing, three saves, Enter and undo', (shape, open, close) => {
    const editor = makeEditor();
    const reference = shape === 'heading' ? '\n\nSee [the endpoint](#get-user).' : '';
    const referenceText = reference ? 'See the endpoint.' : '';
    const source = `${open}${lead}${tail}${close}${reference}`;
    const literal = `{${parameter}}`;
    const expected = `${open}${lead}&#123;${parameter}&#125;${tail}${close}${reference}`;
    try {
      editor.commands.setContent(source, { emitUpdate: false });
      let caret = 0;
      editor.state.doc.descendants((node, pos) => {
        if (node.isText && node.text === lead + tail) caret = pos + lead.length;
      });
      expect(caret).toBeGreaterThan(0);
      editor.commands.setTextSelection(caret);
      editor.view.dispatch(closeHistory(editor.state.tr));
      for (const character of literal) editor.view.dispatch(editor.state.tr.insertText(character));

      const typed = getMarkdown(editor);
      expectReloads(typed, lead + literal + tail + referenceText);
      expect(typed, 'save 1').toBe(expected);
      if (shape === 'heading') expect(readerHeadings(typed)).toEqual([{ id: 'user-content-get-user', depth: 2, text: lead + literal + tail }]);

      editor.view.dispatch(closeHistory(editor.state.tr));
      expect(editor.commands.keyboardShortcut('Enter')).toBe(true);
      expect(editor.state.selection.$from.parent.textContent).toBe(tail);
      const split = getMarkdown(editor);
      expect(split).not.toBe(expected);
      if (shape === 'heading') expect(split.match(/id="get-user"/g)).toHaveLength(1);
      expectReloads(split, lead + literal + tail + referenceText);

      expect(editor.commands.undo()).toBe(true);
      expect(getMarkdown(editor)).toBe(expected);
      expect(editor.commands.undo()).toBe(true);
      expect(getMarkdown(editor)).toBe(source);
    } finally {
      editor.destroy();
    }
  });
});

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

  it('keeps an href-only link free of editor defaults when its paragraph is edited', () => {
    const editor = makeEditor();
    try {
      editor.commands.setContent(`<p align="right">${text} <a href="/x">Link</a></p>`, { emitUpdate: false });
      editor.view.dispatch(editor.state.tr.insertText('!', 2));
      expect(getMarkdown(editor)).toBe(`<p align="right">${text[0]}!${text.slice(1)} <a href="/x">Link</a></p>`);
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

describe.each([
  ['Hi', 'After', 'new', 'end'],
  ['مرحبا', 'بعد', 'جديد', 'النهاية'],
])('structured HTML review, %s', (text, after, badge, end) => {
  const logo = '<img src="/logo.png" alt="Logo" width="200">';
  const firstBadge = '<img src="/a.png" alt="A">';
  const secondBadge = '<img src="/b.png" alt="B">';
  const edited = `${text[0]}!${text.slice(1)}`;

  it.each([
    ['two images', `<p align="center">${firstBadge} ${secondBadge}</p>`, [firstBadge, secondBadge]],
    ['trailing image', `<p align="center">${text} ${logo}</p>`, [text, logo]],
    [
      'linked badge row',
      `<p align="center">\n  <a href="/a">${firstBadge}</a>\n  <a href="/b">${secondBadge}</a>\n</p>`,
      [`\n${firstBadge}`, secondBadge],
    ],
    ['logo with a tagline', `<p align="center">${logo} ${text}</p>`, [logo, text]],
    ['logo in a heading', `<h1 align="center">${logo} ${text}</h1>`, ['# ', logo, ` ${text}`]],
  ])('saves %s once in document order', (_shape, block, expected) => {
    const editor = new Editor({ element: document.createElement('div'), extensions: buildEditorExtensions() });
    try {
      editor.commands.setContent(`${block}\n\n${after}`, { emitUpdate: false });
      expect(getMarkdown(editor)).toBe([...expected, after].join('\n\n'));
    } finally {
      editor.destroy();
    }
  });

  it('keeps inline component source after editing the surrounding text', () => {
    const editor = new Editor({ element: document.createElement('div'), extensions: buildEditorExtensions() });
    try {
      editor.commands.setContent(`<p align="center">${text} <Badge>${badge}</Badge> ${end}</p>`, { emitUpdate: false });
      editor.commands.setTextSelection(2);
      expect(editor.commands.insertContent('!')).toBe(true);
      expect(getMarkdown(editor)).toBe(`${edited} <Badge>${badge}</Badge> ${end}`);
    } finally {
      editor.destroy();
    }
  });

  it('ignores the reserved source attribute supplied in authored HTML', () => {
    const forged = encodeMdxSource(JSON.stringify({ open: '<p class="forged">', close: '</p>', inner: text }));
    const editor = new Editor({ element: document.createElement('div'), extensions: buildEditorExtensions() });
    try {
      editor.commands.setContent(`<p DATA-NIBLEAF-STRUCTURED-SOURCE="${forged}" class="a">${text}</p>`, { emitUpdate: false });
      expect(getMarkdown(editor)).toBe(`<p class="a">${text}</p>`);
    } finally {
      editor.destroy();
    }
  });

  it('keeps authored nested link attributes when editing adjacent text', () => {
    const editor = new Editor({ element: document.createElement('div'), extensions: buildEditorExtensions() });
    try {
      editor.commands.setContent(`<p align="center">${text} <a href="/x" class="btn">${end}</a></p>`, { emitUpdate: false });
      editor.commands.setTextSelection(2);
      expect(editor.commands.insertContent('!')).toBe(true);
      expect(getMarkdown(editor)).toBe(`<p align="center">${edited} <a href="/x" class="btn">${end}</a></p>`);
    } finally {
      editor.destroy();
    }
  });
});
