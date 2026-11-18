// @vitest-environment jsdom
import { writeFileSync } from 'node:fs';
import { Editor } from '@tiptap/core';
import { closeHistory } from '@tiptap/pm/history';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { readLineEndings, restoreLineEndings } from './line-endings';
import { buildEditorExtensions, getMarkdown } from './tiptap-editor';

describe('line endings follow editor positions (#754)', () => {
  let editor: Editor;
  beforeEach(() => {
    editor = new Editor({ element: document.createElement('div'), extensions: buildEditorExtensions() });
  });
  afterEach(() => editor.destroy());

  const load = (page: string) => {
    editor.commands.setContent(page, { emitUpdate: false });
    editor.view.dispatch(closeHistory(editor.state.tr));
  };
  const code = () => {
    let found: { from: number; text: string } | undefined;
    editor.state.doc.descendants((node, pos) => {
      if (node.type.name === 'codeBlock') found = { from: pos + 1, text: node.textContent };
    });
    if (!found) throw new Error('Expected a code block');
    return found;
  };
  const editHeading = (text: string, replacement: string) => {
    let range: { from: number; to: number } | undefined;
    editor.state.doc.descendants((node, pos) => {
      if (node.type.name === 'heading' && node.textContent === text) range = { from: pos + 1, to: pos + 1 + node.content.size };
    });
    if (!range) throw new Error(`Heading not found: ${text}`);
    editor.view.dispatch(editor.state.tr.insertText(replacement, range.from, range.to));
  };

  const mainSave = (source: string) => {
    const storage = editor.storage as unknown as { markdown: { serializer: { serialize(doc: unknown): string } } };
    return restoreLineEndings(readLineEndings(source), storage.markdown.serializer.serialize(editor.state.doc));
  };

  it('final review: a no-op paragraph update keeps every original ending', () => {
    const page = '# Start\r\n\r\nOne\nwrapped.\r\n\r\nTwo.\n\r\n# End';
    load(page);
    const node = editor.state.doc.nodeAt(7);
    if (!node) throw new Error('Expected paragraph');
    editor.view.dispatch(editor.state.tr.setNodeMarkup(7, undefined, { ...node.attrs }));
    expect(getMarkdown(editor)).toBe(page);
  });

  it.each([
    ['heading', '# One\n\r\nTwo.\r\n\r\n# End'],
    ['blockquote', '> One\n> wrapped.\r\n\r\nAfter.'],
    ['codeBlock', '```text\r\none\nwrapped.\r\n```\r\n\r\nAfter.'],
    ['horizontalRule', '---\n\r\nAfter.\r\n\r\nEnd.'],
  ])('final review: a no-op %s wrapper keeps main endings', (type, page) => {
    load(page);
    let at = -1;
    editor.state.doc.descendants((node, pos) => {
      if (at < 0 && node.type.name === type) at = pos;
    });
    const node = editor.state.doc.nodeAt(at);
    if (!node) throw new Error(`Expected ${type}`);
    editor.view.dispatch(editor.state.tr.setNodeMarkup(at, undefined, { ...node.attrs }));
    expect(getMarkdown(editor)).toBe(mainSave(page));
  });

  it.each([
    ['paragraph', '# Start\r\n\r\nOne\nwrapped.\r\n\r\nTwo.\n\r\n# End', { textAlign: 'center' }],
    ['heading', '# One\n\r\nTwo.\n\r\n# End', { level: 2 }],
    ['codeBlock', '```text\nalpha\r\nbeta\n```\r\n\r\nAfter.', { language: 'javascript' }],
  ] as const)('final review: attribute-only %s changes keep main endings', (type, page, attrs) => {
    load(page);
    let at = -1;
    editor.state.doc.descendants((node, pos) => {
      if (at < 0 && node.type.name === type) at = pos;
    });
    const node = editor.state.doc.nodeAt(at);
    if (!node) throw new Error(`Expected ${type}`);
    editor.view.dispatch(editor.state.tr.setNodeMarkup(at, undefined, { ...node.attrs, ...attrs }));
    expect(getMarkdown(editor)).toBe(mainSave(page));
  });

  it('final review: an extra header line does not shift the y row ending', () => {
    load('| H |\r\n| --- |\r\n| x |\r\n| y |\n\r\nAfter.');
    editor.view.dispatch(editor.state.tr.insertText('new\nline', 5));
    expect(getMarkdown(editor)).toBe('| Hnew\r\nline |\r\n| --- |\r\n| x |\r\n| y |\n\r\nAfter.');
  });

  it.each(['J', 'a'])('final review: multiline text in table cell %s keeps the later row ending', (cell) => {
    const page = '| H | J |\r\n| --- | --- |\r\n| x | a |\r\n| y | b |\n\r\nAfter.';
    load(page);
    let at = -1;
    editor.state.doc.descendants((node, pos) => {
      if (node.isText && node.text === cell) at = pos + cell.length;
    });
    if (at < 0) throw new Error('Expected table cell text');
    editor.view.dispatch(editor.state.tr.insertText('new\nline', at));
    expect(getMarkdown(editor)).toBe(mainSave(page));
    expect(getMarkdown(editor)).toContain('| y | b |\n\r\nAfter.');
  });

  it('keeps the two identical paragraphs and their blank lines when both headings change (repro 1)', () => {
    load('# Start\r\n\r\nx\n\r\nx\r\n\r\n# End');
    editHeading('Start', 'Edited start');
    editHeading('End', 'Edited end');
    expect(getMarkdown(editor)).toBe('# Edited start\r\n\r\nx\n\r\nx\r\n\r\n# Edited end');
  });

  it('deletes the second identical fence line together with its LF (repro 2)', () => {
    load('```text\r\nx\r\nx\nx\r\nx\r\n```');
    const { from } = code();
    editor.view.dispatch(editor.state.tr.delete(from + 2, from + 4));
    expect(getMarkdown(editor)).toBe('```text\r\nx\r\nx\r\nx\r\n```');
  });

  it('maps edits chained after setContent from the setContent step boundary', () => {
    editor
      .chain()
      .setContent('```text\r\nx\r\nx\nx\r\nx\r\n```')
      .command(({ tr }) => {
        tr.delete(3, 5);
        return true;
      })
      .run();
    expect(getMarkdown(editor)).toBe('```text\r\nx\r\nx\r\nx\r\n```');
  });

  const styles = [
    { name: 'mixed LF/CRLF', opening: '\r\n', ending: (index: number) => (index % 3 === 1 ? '\n' : '\r\n') },
    { name: 'lone CR', opening: '\r', ending: (_index: number) => '\r' },
    { name: 'mixed CR/CRLF', opening: '\r\n', ending: (index: number) => (index % 3 === 1 ? '\r' : '\r\n') },
  ];
  const fence = (opening: string, rows: readonly { text: string; ending: string }[]) =>
    `\`\`\`text${opening}${rows.map(({ text, ending }) => text + ending).join('')}\`\`\``;

  for (const style of styles) {
    for (const index of [0, 20, 39]) {
      it(`${style.name}: changing text on line ${index + 1} leaves every other ending alone`, () => {
        const rows = Array.from({ length: 40 }, (_, at) => ({ text: 'x', ending: style.ending(at) }));
        load(fence(style.opening, rows));
        editor.view.dispatch(editor.state.tr.insertText('edited ', code().from + 2 * index));
        const expected = rows.map((row, at) => (at === index ? { text: 'edited x', ending: style.opening } : row));
        expect(getMarkdown(editor)).toBe(fence(style.opening, expected));
      });
    }
    for (const index of [0, 20, 39]) {
      it(`${style.name}: deleting identical line ${index + 1} keeps each survivor's ending`, () => {
        const rows = Array.from({ length: 40 }, (_, at) => ({ text: 'x', ending: style.ending(at) }));
        load(fence(style.opening, rows));
        const { from, text } = code();
        const start = from + 2 * index;
        editor.view.dispatch(index === 39 ? editor.state.tr.delete(start - 1, from + text.length) : editor.state.tr.delete(start, start + 2));
        expect(getMarkdown(editor)).toBe(
          fence(
            style.opening,
            rows.filter((_, at) => at !== index),
          ),
        );
      });
    }
    for (const index of [0, 20, 40]) {
      it(`${style.name}: inserting among 40 identical lines at ${index} keeps all old endings`, () => {
        const rows = Array.from({ length: 40 }, (_, at) => ({ text: 'x', ending: style.ending(at) }));
        load(fence(style.opening, rows));
        const { from, text } = code();
        editor.view.dispatch(editor.state.tr.insertText(index === 40 ? '\nx' : 'x\n', index === 40 ? from + text.length : from + 2 * index));
        const expected = [...rows];
        expected.splice(index, 0, { text: 'x', ending: style.opening });
        expect(getMarkdown(editor)).toBe(fence(style.opening, expected));
      });
    }
  }

  it('undo/redo restores ending ownership even when the resulting repeated text is identical', () => {
    const page = '```text\r\nx\r\nx\nx\r\nx\r\n```';
    load(page);
    const { from } = code();
    editor.view.dispatch(editor.state.tr.delete(from + 2, from + 4));
    const deleted = '```text\r\nx\r\nx\r\nx\r\n```';
    expect(getMarkdown(editor)).toBe(deleted);
    expect(editor.commands.undo()).toBe(true);
    expect(getMarkdown(editor)).toBe(page);
    expect(editor.commands.redo()).toBe(true);
    expect(getMarkdown(editor)).toBe(deleted);
  });

  it('history bookmarks map endings through a later edit excluded from history', () => {
    const page = '```text\r\nx\r\nx\nx\r\nx\r\n```';
    load(page);
    const { from } = code();
    editor.view.dispatch(editor.state.tr.delete(from + 2, from + 4));
    editor.view.dispatch(editor.state.tr.insertText('prefix ', from).setMeta('addToHistory', false));
    expect(editor.commands.undo()).toBe(true);
    expect(getMarkdown(editor)).toBe(page.replace('x\r\n', 'prefix x\r\n'));
  });

  it('a paste into a fence creates new lines without transferring a survivor’s ending', () => {
    load('```text\r\nx\r\nx\nx\r\nx\r\n```');
    const { from } = code();
    editor.commands.setTextSelection(from + 4);
    editor.view.pasteText('pasted\n', new Event('paste') as ClipboardEvent);
    expect(getMarkdown(editor)).toBe('```text\r\nx\r\nx\npasted\r\nx\r\nx\r\n```');
  });

  it('keeps formatted paragraphs and their separators between edited headings', () => {
    const page = '# Start\r\n\r\nText with **bold**.\n\r\nx\r\n\r\n# End';
    load(page);
    editHeading('Start', 'Edited start');
    editHeading('End', 'Edited end');
    expect(getMarkdown(editor)).toBe(page.replace('Start', 'Edited start').replace('End', 'Edited end'));
  });

  it('keeps identical loose list items and their separators between edited headings', () => {
    const page = '# Start\r\n\r\n- x\n\r\n- x\r\n\r\n# End';
    load(page);
    editHeading('Start', 'Edited start');
    editHeading('End', 'Edited end');
    expect(getMarkdown(editor)).toBe(page.replace('Start', 'Edited start').replace('End', 'Edited end'));
  });

  it('keeps empty list items distinct when another item is deleted', () => {
    load('- \r\n- \n- \r\n- \r\n\r\nAfter.');
    let range: { from: number; to: number } | undefined;
    editor.state.doc.descendants((node, pos) => {
      if (node.type.name !== 'bulletList') return;
      node.forEach((item, offset, index) => {
        if (index === 1) range = { from: pos + 1 + offset, to: pos + 1 + offset + item.nodeSize };
      });
    });
    if (!range) throw new Error('Expected empty list item');
    editor.view.dispatch(editor.state.tr.delete(range.from, range.to));
    expect(getMarkdown(editor)).toBe('- \r\n- \r\n- \r\n\r\nAfter.');
  });

  it.each([
    ['quote', '> x\n>\r\n> x'],
    ['component', '<Note>\r\n\r\nx\n\r\nx\r\n\r\n</Note>'],
  ])('keeps repeated lines inside a %s when outside headings change', (_name, block) => {
    const page = `# Start\r\n\r\n${block}\r\n\r\n# End`;
    load(page);
    editHeading('Start', 'Edited start');
    editHeading('End', 'Edited end');
    expect(getMarkdown(editor)).toBe(page.replace('Start', 'Edited start').replace('End', 'Edited end'));
  });

  it('keeps a component closer’s LF when its edited children need a new opening separator', () => {
    load('<Note>\r\nFirst.\r\n</Note>\n\r\n# End');
    let at: number | undefined;
    editor.state.doc.forEach((node, pos) => {
      if (node.firstChild?.type.name === 'paragraph' && node.firstChild.textContent === 'First.') at = pos + 1;
    });
    if (at === undefined) throw new Error('Expected component body');
    editor.commands.insertContentAt(at, { type: 'paragraph' });
    expect(getMarkdown(editor)).toContain('</Note>\n\r\n# End');
  });

  it('maps identical table rows through a row deletion', () => {
    load('| H |\r\n| --- |\r\n| x |\r\n| x |\n| x |\r\n');
    let range: { from: number; to: number } | undefined;
    editor.state.doc.descendants((node, pos) => {
      if (node.type.name !== 'table') return;
      node.forEach((row, offset, index) => {
        if (index === 2) range = { from: pos + 1 + offset, to: pos + 1 + offset + row.nodeSize };
      });
    });
    if (!range) throw new Error('Expected table row');
    editor.view.dispatch(editor.state.tr.delete(range.from, range.to));
    expect(getMarkdown(editor)).toBe('| H |\r\n| --- |\r\n| x |\r\n| x |\r\n');
  });

  it('restores a grouped sequence of repeated-line edits with one undo', () => {
    const page = '```text\r\nx\r\nx\nx\r\nx\r\n```';
    load(page);
    const { from } = code();
    editor.view.dispatch(editor.state.tr.delete(from + 2, from + 4));
    editor.view.dispatch(editor.state.tr.insertText('x\n', from + 2));
    expect(editor.commands.undo()).toBe(true);
    expect(getMarkdown(editor)).toBe(page);
    expect(editor.commands.redo()).toBe(true);
    expect(getMarkdown(editor)).toBe('```text\r\nx\r\nx\r\nx\r\nx\r\n```');
  });

  it('replace-all in a fence does not borrow endings from identical old text', () => {
    load('```text\r\nx\nx\r\nx\r\n```');
    const { from, text } = code();
    editor.view.dispatch(editor.state.tr.insertText('x\nx\nx', from, from + text.length));
    expect(getMarkdown(editor)).toBe('```text\r\nx\r\nx\r\nx\r\n```');
  });

  it.each([
    ['CRLF', '# Title\r\n\r\nText.\r\n\r\n```text\r\nx\r\nx\r\n```'],
    ['CR', '# Title\r\rText.\r\r```text\rx\rx\r```'],
    ['mixed', '# Title\r\n\nText.\r\r\n```text\nx\rx\r\n```'],
  ])('%s stays byte-identical for ten load/save cycles', (_name, page) => {
    let saved = page;
    for (let cycle = 0; cycle < 10; cycle++) {
      load(saved);
      saved = getMarkdown(editor);
      expect(saved, `cycle ${cycle + 1}`).toBe(page);
    }
  });

  it.runIf(process.env.LINE_ENDINGS_BENCH)(
    'reports mapping and save costs on 1M-character pages',
    () => {
      const body = `${'x'.repeat(48)}\n`.repeat(Math.floor((1_000_000 - 12) / 49));
      const lf = `\`\`\`text\n${body}${'x'.repeat(1_000_000 - 12 - body.length)}\n\`\`\``;
      expect(lf.length).toBe(1_000_000);
      const results: Array<{ format: string; characters: number; normalizedCharacters: number; loadMs: number; mappingMs: number; saveMs: number }> =
        [];
      for (const format of ['LF', 'CRLF', 'mixed']) {
        let line = 0;
        const page = format === 'LF' ? lf : lf.replace(/\n/g, () => (format === 'mixed' && ++line % 3 === 0 ? '\n' : '\r\n'));
        const start = performance.now();
        load(page);
        const loadMs = performance.now() - start;
        const base = editor.state;
        const at = code().from + Math.floor(code().text.length / 2);
        const mapping: number[] = [];
        const save: number[] = [];
        for (let sample = 0; sample < 7; sample++) {
          const transaction = base.tr.insertText('!', at);
          const beforeMap = performance.now();
          const next = base.applyTransaction(transaction).state;
          mapping.push(performance.now() - beforeMap);
          editor.view.updateState(next);
          const beforeSave = performance.now();
          const saved = getMarkdown(editor);
          save.push(performance.now() - beforeSave);
          const sourceOffset = 8 + at - code().from;
          expect(saved.replace(/\r\n?/g, '\n')).toBe(`${lf.slice(0, sourceOffset)}!${lf.slice(sourceOffset)}`);
          editor.view.updateState(base);
        }
        const median = (samples: number[]) => samples.sort((a, b) => a - b)[Math.floor(samples.length / 2)] as number;
        results.push({ format, characters: page.length, normalizedCharacters: lf.length, loadMs, mappingMs: median(mapping), saveMs: median(save) });
      }
      const output = process.env.LINE_ENDINGS_BENCH_OUT;
      if (output) writeFileSync(output, `${JSON.stringify(results, null, 2)}\n`);
      expect(results).toHaveLength(3);
    },
    120_000,
  );
});
