// @vitest-environment jsdom
import { type Content, Editor, Extension } from '@tiptap/core';
import { closeHistory } from '@tiptap/pm/history';
import { Plugin } from '@tiptap/pm/state';
import { afterAll, afterEach, beforeEach, describe, expect, it } from 'vitest';
import { MarkdownOutput } from './markdown-output';
import { buildEditorExtensions, getMarkdown } from './tiptap-editor';

/*
 * Exact-output regressions for the editor's own serializer state (#612). Its
 * bold/italic trimming reads only a short window behind each run instead of the
 * whole output. The window must reach two UTF-16 units back: a run can follow an
 * astral character (one code point, two units), and a one-unit window then reads
 * half a surrogate pair and decides the run's flanking wrongly. The 1,000-page
 * differential has astral emoji but not an astral letter right before a run that
 * starts with punctuation, so this pins that boundary on its own.
 */
describe('editor Markdown output: exact boundaries', () => {
  const editor = new Editor({ element: document.createElement('div'), extensions: buildEditorExtensions() });
  afterAll(() => editor.destroy());

  const paragraph = (...content: object[]) => ({ type: 'doc', content: [{ type: 'paragraph', content }] });
  const text = (value: string, marks?: string[]) => ({ type: 'text', text: value, ...(marks ? { marks: marks.map((type) => ({ type })) } : {}) });

  it.each([
    // Found by the independent review of #693: a one-unit window gives `𝔄**!x**z`.
    ['bold after an astral letter, starting with punctuation', paragraph(text('𝔄'), text('!x', ['bold']), text('z')), '𝔄!**x**z'],
    ['italic after an astral letter, starting with punctuation', paragraph(text('𝔄'), text('!x', ['italic']), text('z')), '𝔄!*x*z'],
    ['bold after a BMP letter, starting with punctuation', paragraph(text('A'), text('!x', ['bold']), text('z')), 'A!**x**z'],
  ])('%s', (_name, doc, expected) => {
    editor.commands.setContent(doc);
    expect(getMarkdown(editor).trim()).toBe(expected);
  });
});

describe('a page’s line endings across a dry run of setContent (#702)', () => {
  const editor = new Editor({ element: document.createElement('div'), extensions: buildEditorExtensions() });
  afterAll(() => editor.destroy());

  it('`editor.can().setContent(…)` replaces nothing, so the page keeps its CRLF endings', () => {
    const page = 'One.\r\n\r\nTwo.\r\n\r\nThree.';
    editor.commands.setContent(page, { emitUpdate: false });
    // TipTap runs a capability check without `dispatch`: no document is set.
    expect(editor.can().setContent('Other.')).toBe(true);
    expect(getMarkdown(editor)).toBe(page);
    editor.view.dispatch(editor.state.tr.insertText('Edited ', 1));
    expect(getMarkdown(editor)).toBe('Edited One.\r\n\r\nTwo.\r\n\r\nThree.');
  });
});

describe('setContent records line endings only when its transaction is applied (#761)', () => {
  let editor: Editor;
  beforeEach(() => {
    editor = new Editor({ element: document.createElement('div'), extensions: buildEditorExtensions() });
  });
  afterEach(() => editor.destroy());

  const endings = ['\r\n', '\r'] as const;
  const paragraph = { type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Other.' }] }] };
  const replacements = [
    ['LF Markdown', 'Other.\n\nPage.'],
    ['CRLF Markdown', 'Other.\r\n\r\nPage.'],
    ['JSON', paragraph],
  ] as const;

  it.each(endings.flatMap((ending) => replacements.map(([name, content]) => ({ ending, name, content }))))(
    'an unrun chain setting $name keeps the current $ending page on the next save',
    ({ ending, content }) => {
      const page = ['One.', '', 'Two.', '', 'Three.'].join(ending);
      editor.commands.setContent(page, { emitUpdate: false });
      const before = editor.getJSON();
      editor.chain().setContent(content);
      expect(editor.getJSON()).toEqual(before);
      expect(getMarkdown(editor)).toBe(page);
      editor.view.dispatch(editor.state.tr.insertText('Edited ', 1));
      expect(getMarkdown(editor)).toBe(`Edited ${page}`);
    },
  );

  it.each(endings)('a capability check keeps %j endings on the next save', (ending) => {
    const page = ['One.', '', 'Two.'].join(ending);
    editor.commands.setContent(page, { emitUpdate: false });
    expect(editor.can().setContent('Other.')).toBe(true);
    expect(editor.can().chain().setContent(paragraph).run()).toBe(true);
    editor.view.dispatch(editor.state.tr.insertText('Edited ', 1));
    expect(getMarkdown(editor)).toBe(`Edited ${page}`);
  });

  it.each(['\n', ...endings])('a run chain records the replacement page’s %j endings', (ending) => {
    editor.commands.setContent('Before.\r\n\r\nPage.');
    const page = ['After.', '', 'Page.'].join(ending);
    expect(editor.chain().setContent(page).run()).toBe(true);
    expect(getMarkdown(editor)).toBe(page);
    editor.view.dispatch(editor.state.tr.insertText('Edited ', 1));
    expect(getMarkdown(editor)).toBe(`Edited ${page}`);
  });

  it('a run chain setting JSON clears the previous source endings', () => {
    editor.commands.setContent('Before.\r\n\r\nPage.');
    expect(
      editor
        .chain()
        .setContent({ type: 'doc', content: [...paragraph.content, ...paragraph.content] })
        .run(),
    ).toBe(true);
    expect(getMarkdown(editor)).toBe('Other.\n\nOther.');
  });

  it.each(endings)('a silent setContent records %j endings even when the document is equal', (ending) => {
    editor.commands.setContent('One.\n\nTwo.');
    const page = ['One.', '', 'Two.'].join(ending);
    let updates = 0;
    editor.on('update', () => updates++);
    editor.commands.setContent(page, { emitUpdate: false });
    expect(updates).toBe(0);
    expect(getMarkdown(editor)).toBe(page);
  });

  it.each(endings)('the update listener saves with the applied %j endings', (ending) => {
    const page = ['One.', '', 'Two.'].join(ending);
    const saved: string[] = [];
    editor.on('update', () => saved.push(getMarkdown(editor)));
    editor.chain().setContent(page).run();
    expect(saved).toEqual([page]);
  });

  it.each(endings)('undo/redo across setContent keeps main’s latest-source %j ending behavior', (ending) => {
    // Main keeps the most recently set source endings across history steps;
    // undo restores the document, without restoring a previous source snapshot.
    editor.commands.setContent('Before.\n\nPage.');
    editor.view.dispatch(closeHistory(editor.state.tr));
    const page = ['After.', '', 'Page.'].join(ending);
    editor.chain().setContent(page).run();
    expect(getMarkdown(editor)).toBe(page);
    expect(editor.commands.undo()).toBe(true);
    expect(getMarkdown(editor)).toBe(['Before.', '', 'Page.'].join(ending));
    expect(editor.commands.redo()).toBe(true);
    expect(getMarkdown(editor)).toBe(page);
  });

  it.each([
    ['CRLF', '# Title\r\n\r\nText.\r\n\r\n```text\r\none\r\ntwo\r\n```'],
    ['CR', '# Title\r\rText.\r\r```text\rone\rtwo\r```'],
    ['mixed', '# Title\r\n\nText.\r\r\n```text\none\rtwo\r\n```'],
  ])('%s pages stay byte-identical over ten load/save cycles with abandoned chains', (_name, page) => {
    let saved = page;
    for (let cycle = 0; cycle < 10; cycle++) {
      editor.commands.setContent(saved, { emitUpdate: false });
      editor.chain().setContent('Abandoned.');
      saved = getMarkdown(editor);
      expect(saved, `cycle ${cycle + 1}`).toBe(page);
    }
  });
});

describe('setContent source endings through dispatch and step replay (#872)', () => {
  let editor: Editor;
  afterEach(() => editor.destroy());

  const make = (replacement: Content, viaChain = false) => {
    const shortcut = Extension.create({
      name: 'replacePageShortcut',
      addKeyboardShortcuts() {
        return {
          'Mod-Alt-r': () =>
            viaChain
              ? this.editor
                  .chain()
                  .command(({ chain }) => chain().setContent(replacement).run())
                  .run()
              : this.editor.commands.setContent(replacement),
        };
      },
    });
    editor = new Editor({ element: document.createElement('div'), extensions: [...buildEditorExtensions(), shortcut] });
    return editor;
  };

  it.each(['\r\n', '\r'])('keyboardShortcut replays setContent with its %j source endings', (ending) => {
    const page = ['After.', '', 'Page.'].join(ending);
    make(page).commands.setContent('Before.\n\nPage.');
    expect(editor.commands.keyboardShortcut('Mod-Alt-r')).toBe(true);
    expect(editor.state.doc.textContent).toBe('After.Page.');
    expect(getMarkdown(editor)).toBe(page);
    editor.view.dispatch(editor.state.tr.insertText('Edited ', 1));
    expect(getMarkdown(editor)).toBe(`Edited ${page}`);
  });

  it('a replayed JSON replacement clears the previous CRLF source', () => {
    make({
      type: 'doc',
      content: [
        { type: 'paragraph', content: [{ type: 'text', text: 'After.' }] },
        { type: 'paragraph', content: [{ type: 'text', text: 'Page.' }] },
      ],
    });
    editor.commands.setContent('Before.\r\n\r\nPage.');
    expect(editor.commands.keyboardShortcut('Mod-Alt-r')).toBe(true);
    expect(getMarkdown(editor)).toBe('After.\n\nPage.');
  });

  it('a captured chain inside a chain keeps the replacement source', () => {
    const page = 'After.\r\n\r\nPage.';
    make(page, true).commands.setContent('Before.\n\nPage.');
    expect(editor.chain().keyboardShortcut('Mod-Alt-r').insertContentAt(1, 'Edited ').run()).toBe(true);
    expect(getMarkdown(editor)).toBe(`Edited ${page}`);
  });

  it('an unrun shortcut chain and its capability check keep the current source', () => {
    make('After.\r\n\r\nPage.').commands.setContent('Before.\r\rPage.');
    editor.chain().keyboardShortcut('Mod-Alt-r');
    expect(editor.can().keyboardShortcut('Mod-Alt-r')).toBe(true);
    editor.view.dispatch(editor.state.tr.insertText('Edited ', 1));
    expect(getMarkdown(editor)).toBe('Edited Before.\r\rPage.');
  });

  it.each([false, true])('the last replacement wins across direct and replayed steps (shortcut last: %s)', (shortcutLast) => {
    make('Shortcut.\r\n\r\nPage.').commands.setContent('Before.\n\nPage.');
    const chain = editor.chain();
    if (shortcutLast) chain.setContent('Direct.\r\rPage.').keyboardShortcut('Mod-Alt-r');
    else chain.keyboardShortcut('Mod-Alt-r').setContent('Direct.\r\rPage.');
    expect(chain.run()).toBe(true);
    expect(getMarkdown(editor)).toBe(shortcutLast ? 'Shortcut.\r\n\r\nPage.' : 'Direct.\r\rPage.');
  });

  it.each(['\r\n', '\r'])('commands.first and a nested chain record %j endings', (ending) => {
    const page = ['After.', '', 'Page.'].join(ending);
    make(page).commands.setContent('Before.\n\nPage.');
    expect(editor.commands.first([() => false, ({ commands }) => commands.setContent(page)])).toBe(true);
    expect(getMarkdown(editor)).toBe(page);
    editor.commands.setContent('Before.\n\nPage.');
    expect(
      editor
        .chain()
        .command(({ chain }) => chain().setContent(page).insertContentAt(1, 'Edited ').run())
        .run(),
    ).toBe(true);
    expect(getMarkdown(editor)).toBe(`Edited ${page}`);
  });

  it('whole-document insertContentAt retains the page source, as it does on main', () => {
    make('Unused.').commands.setContent('Before.\r\rPage.');
    expect(editor.commands.insertContentAt({ from: 0, to: editor.state.doc.content.size }, 'After.\n\nPage.')).toBe(true);
    expect(getMarkdown(editor)).toBe('After.\r\rPage.');
  });

  it('a plugin-dispatched setContent records its source before saving', () => {
    const page = 'After.\r\n\r\nPage.';
    let pending = false;
    const replace = Extension.create({
      name: 'replacePagePlugin',
      addProseMirrorPlugins() {
        return [
          new Plugin({
            view: () => ({
              update: () => {
                if (pending) {
                  pending = false;
                  this.editor.commands.setContent(page);
                }
              },
            }),
          }),
        ];
      },
    });
    editor = new Editor({ element: document.createElement('div'), extensions: [...buildEditorExtensions(), replace] });
    editor.commands.setContent('Before.\n\nPage.');
    pending = true;
    editor.view.dispatch(editor.state.tr.setMeta('replaceFromPlugin', true));
    expect(getMarkdown(editor)).toBe(page);
  });

  it('undo/redo of a replayed replacement keeps the latest source across subsequent setContent', () => {
    make('After.\r\n\r\nPage.').commands.setContent('Before.\n\nPage.');
    editor.view.dispatch(closeHistory(editor.state.tr));
    editor.commands.keyboardShortcut('Mod-Alt-r');
    expect(editor.commands.undo()).toBe(true);
    expect(getMarkdown(editor)).toBe('Before.\r\n\r\nPage.');
    expect(editor.commands.redo()).toBe(true);
    expect(getMarkdown(editor)).toBe('After.\r\n\r\nPage.');
    editor.view.dispatch(closeHistory(editor.state.tr));
    editor.commands.setContent('After.\r\rPage.', { emitUpdate: false });
    expect(editor.commands.undo()).toBe(true);
    expect(getMarkdown(editor)).toBe('After.\r\rPage.');
    expect(editor.commands.redo()).toBe(true);
    expect(getMarkdown(editor)).toBe('After.\r\rPage.');
  });
});

// A component's tight layout (#606) reads its children's first and last lines back and
// puts a blank line in before them: each reads one line only, across the pieces written.
describe('the output read back next to a component’s tags (#606)', () => {
  const written = (...pieces: string[]) => {
    const output = new MarkdownOutput();
    for (const piece of pieces) output.append(piece);
    return output;
  };

  it('`lastLine` is the last line, without a line break that ends it', () => {
    expect(written('<Note>\n', '| A ', '| B |\n').lastLine()).toBe('| A | B |');
    expect(written('<Note>\nTe', 'xt').lastLine()).toBe('Text');
    expect(written('a\n', '\n').lastLine()).toBe('');
    expect(written().lastLine()).toBe('');
    const long = written('x'.repeat(10_000), '\n', 'tail');
    const before = long.charactersRead;
    expect(long.lastLine()).toBe('tail');
    expect(long.charactersRead - before).toBeLessThanOrEqual(5);
  });

  it('`lineFrom` reads to the next line break; `insertAt` puts text in before what follows', () => {
    const output = written('<Note>\n', '> ', 'quo', 'ted\nTail');
    expect(output.lineFrom(7)).toBe('> quoted');
    expect(output.lineFrom(9)).toBe('quoted');
    output.insertAt(7, '\n');
    output.insertAt(output.length, '\n');
    expect(output.length).toBe(22);
    expect(output.sliceFrom(0)).toBe('<Note>\n\n> quoted\nTail\n');
  });
});
