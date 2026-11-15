/** @vitest-environment jsdom */
/*
 * P2-ED-005: the per-keystroke work moved or shrank, and what the writer sees
 * must not change. Each check compares what the editor shows with what the
 * previous code computed from scratch, over seeded documents and seeded edits:
 * - word and character counts: CharacterCount's own whole-document count;
 * - code highlighting: CodeBlockLowlight's own plugin, computed for the document;
 * - comment highlights: the previous search, one `findQuoteRange` per comment.
 * These read only the editor's public surfaces, so they pass on the code before
 * the change too (guards). The one check that does not is named so: the code
 * block highlighting plugin is installed once, not twice.
 */
import { STARTER_PAGE_CONTENTS } from '@nibleaf/auth/starter-content';
import { Editor } from '@tiptap/core';
import CodeBlockLowlight from '@tiptap/extension-code-block-lowlight';
import type { Node as PMNode } from '@tiptap/pm/model';
import { type Plugin, TextSelection } from '@tiptap/pm/state';
import type { DecorationSet, EditorView } from '@tiptap/pm/view';
import { common, createLowlight } from 'lowlight';
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { HARD_WRAPPED_AR, HARD_WRAPPED_EN, IMPORTED_INTRODUCTION, IMPORTED_QUICKSTART } from './__fixtures__/hard-wrapped-pages';
import { redrawTransaction } from './editor-change-origin';
import { type CommentMarker, findQuoteRange } from './extensions/comment-decorations';
import { buildEditorExtensions } from './tiptap-editor';

/** A small seeded generator, so every run checks the same documents and edits. */
function random(seed: number) {
  let state = seed >>> 0;
  const next = () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  const int = (max: number) => Math.floor(next() * max);
  const pick = <T>(items: readonly T[]): T => items[int(items.length)] as T;
  return { next, int, pick };
}

const WORDS = ['alpha', 'beta', 'gamma', 'delta', 'regular', 'hard-wrapped', 'كلمة', 'عربية', 'naïve', 'x', '—', '2026', 'emoji🙂'];
const LANGUAGES = ['ts', 'js', 'json', 'bash', 'python', 'css', 'not-a-language', ''];
const CODE = ['const a = 1;', 'function f(x) { return x * 2 }', '{"key": [1, 2, null]}', 'echo "$HOME" | grep -v x', 'def g():\n    return None', '.a > b { color: red }', '<div class="x">y</div>'];

/** A seeded Markdown page with the blocks the editor knows. */
function generatedPage(seed: number): string {
  const r = random(seed);
  const words = (count: number) => Array.from({ length: count }, () => r.pick(WORDS)).join(' ');
  const inline = () => {
    const text = words(1 + r.int(12));
    switch (r.int(6)) {
      case 0:
        return `**${text}** ${words(2)}`;
      case 1:
        return `${text} \`${r.pick(WORDS)}\``;
      case 2:
        return `[${text}](https://example.com/${r.int(99)})`;
      case 3:
        return `${text}  \n${words(3)}`;
      default:
        return text;
    }
  };
  const blocks: string[] = [];
  const count = 6 + r.int(14);
  for (let index = 0; index < count; index += 1) {
    switch (r.int(10)) {
      case 0:
        blocks.push(`${'#'.repeat(1 + r.int(3))} ${words(1 + r.int(4))}`);
        break;
      case 1:
        blocks.push(Array.from({ length: 1 + r.int(4) }, () => `- ${inline()}`).join('\n'));
        break;
      case 2:
        blocks.push(Array.from({ length: 1 + r.int(4) }, (_, item) => `${item + 1}. ${inline()}`).join('\n'));
        break;
      case 3:
        blocks.push(`\`\`\`${r.pick(LANGUAGES)}\n${Array.from({ length: 1 + r.int(4) }, () => r.pick(CODE)).join('\n')}\n\`\`\``);
        break;
      case 4:
        blocks.push(`> ${inline()}`);
        break;
      case 5:
        blocks.push(`| ${words(1)} | ${words(1)} |\n| --- | --- |\n| ${words(2)} | ${words(1)} |`);
        break;
      case 6:
        blocks.push(`![${words(2)}](https://example.com/${r.int(9)}.png)`);
        break;
      case 7:
        blocks.push('---');
        break;
      default:
        blocks.push(inline());
    }
  }
  return blocks.join('\n\n');
}

const PAGES: Array<[string, string]> = [
  ...STARTER_PAGE_CONTENTS.map(({ title, content }): [string, string] => [`starter: ${title}`, content]),
  ['hard-wrapped (en)', HARD_WRAPPED_EN],
  ['hard-wrapped (ar)', HARD_WRAPPED_AR],
  ['imported Introduction', IMPORTED_INTRODUCTION],
  ['imported Quickstart', IMPORTED_QUICKSTART],
  ...Array.from({ length: 12 }, (_, index): [string, string] => [`generated #${index + 1}`, generatedPage(1000 + index)]),
];

const editors: Editor[] = [];
function load(markdown: string, options: Parameters<typeof buildEditorExtensions>[0] = {}): Editor {
  const editor = new Editor({ element: document.createElement('div'), extensions: buildEditorExtensions(options) });
  editors.push(editor);
  editor.commands.setContent(markdown, { emitUpdate: false });
  return editor;
}
afterEach(() => {
  for (const editor of editors.splice(0)) editor.destroy();
});

/** Positions inside text, where a keystroke can land. */
function textPositions(doc: PMNode): number[] {
  const positions: number[] = [];
  doc.descendants((node, pos) => {
    if (node.isTextblock) positions.push(pos + 1, pos + node.nodeSize - 1);
    if (node.isText) positions.push(pos + Math.floor((node.text?.length ?? 0) / 2));
  });
  return positions;
}

/** One seeded edit, dispatched through the view as typing or a command would be. */
function randomEdit(editor: Editor, r: ReturnType<typeof random>): string {
  const { view } = editor;
  const positions = textPositions(view.state.doc);
  if (positions.length === 0) return 'none';
  const at = r.pick(positions);
  const kind = r.int(7);
  const tr = view.state.tr;
  try {
    if (kind <= 2) {
      view.dispatch(tr.insertText(r.pick([' ', 'a', ' word ', 'كلمة', ' ', 'x y']), at));
      return 'type';
    }
    if (kind === 3) {
      const to = Math.min(view.state.doc.content.size, at + 1 + r.int(6));
      view.dispatch(tr.delete(at, to));
      return 'delete';
    }
    if (kind === 4) {
      view.dispatch(tr.setSelection(TextSelection.create(tr.doc, at)));
      editor.commands.enter();
      return 'enter';
    }
    if (kind === 5) {
      view.dispatch(tr.setSelection(TextSelection.create(tr.doc, at)));
      editor.commands.joinBackward();
      return 'join';
    }
    view.dispatch(tr.setSelection(TextSelection.create(tr.doc, at)));
    editor.commands.setHardBreak();
    return 'break';
  } catch {
    // An edit the schema refuses at this position: nothing changed.
    return 'refused';
  }
}

const tally: Record<string, number> = {};
const count = (name: string, n = 1) => {
  tally[name] = (tally[name] ?? 0) + n;
};
afterAll(() => {
  // The number of comparisons each check made, for the PR's equivalence counts.
  console.info(`[P2-ED-005 equivalence] ${JSON.stringify(tally)}`);
});

describe('word and character counts equal CharacterCount’s whole-document count', () => {
  const stock = (doc: PMNode) => ({
    words: doc
      .textBetween(0, doc.content.size, ' ', ' ')
      .split(' ')
      .filter((word) => word !== '').length,
    characters: doc.textBetween(0, doc.content.size, undefined, ' ').length,
  });
  const shown = (editor: Editor) => {
    const storage = editor.storage as unknown as { characterCount: { words(): number; characters(): number } };
    return { words: storage.characterCount.words(), characters: storage.characterCount.characters() };
  };

  it.each(PAGES)('%s, and after 40 seeded edits', (_name, markdown) => {
    const editor = load(markdown);
    expect(shown(editor)).toEqual(stock(editor.state.doc));
    count('counts');
    const r = random(markdown.length);
    for (let index = 0; index < 40; index += 1) {
      randomEdit(editor, r);
      expect(shown(editor)).toEqual(stock(editor.state.doc));
      count('counts');
    }
  });

  it('an empty page, and a page of one empty paragraph', () => {
    for (const markdown of ['', '\n\n']) {
      const editor = load(markdown);
      expect(shown(editor)).toEqual(stock(editor.state.doc));
      count('counts');
    }
  });
});

describe('code highlighting equals CodeBlockLowlight’s', () => {
  const lowlight = createLowlight(common);
  // CodeBlockLowlight's own plugin, as the code before the change installed it.
  const [reference] = (CodeBlockLowlight.config.addProseMirrorPlugins as (this: unknown) => Plugin<DecorationSet>[]).call({
    name: 'codeBlock',
    options: { lowlight, defaultLanguage: null },
    parent: () => [],
  });
  const expected = (editor: Editor) => normalize(reference?.spec.state?.init({} as never, editor.state) as DecorationSet);
  const highlightPlugins = (editor: Editor) =>
    editor.state.plugins.filter((plugin) => /^(lowlight|codeBlockHighlight)\$/.test((plugin as unknown as { key: string }).key));
  const normalize = (set: DecorationSet) =>
    set
      .find()
      .map((decoration) => ({ from: decoration.from, to: decoration.to, attrs: (decoration as unknown as { type: { attrs: unknown } }).type.attrs }))
      .sort((a, b) => a.from - b.from || a.to - b.to);
  const check = (editor: Editor) => {
    const want = expected(editor);
    for (const plugin of highlightPlugins(editor)) expect(normalize(plugin.getState(editor.state) as DecorationSet)).toEqual(want);
    count('highlight');
  };

  it('one highlighting plugin is installed, not two (fails before the change)', () => {
    expect(highlightPlugins(load('```ts\nconst a = 1;\n```'))).toHaveLength(1);
  });

  it.each(PAGES)('%s, and after 40 seeded edits', (_name, markdown) => {
    const editor = load(markdown);
    check(editor);
    const r = random(markdown.length + 7);
    for (let index = 0; index < 40; index += 1) {
      randomEdit(editor, r);
      check(editor);
    }
  });

  /** The first code block's position. */
  const firstCodeBlock = (editor: Editor) => {
    let at = -1;
    editor.state.doc.descendants((node, pos) => {
      if (at < 0 && node.type.name === 'codeBlock') at = pos;
      return at < 0;
    });
    return at;
  };
  const page = ['Intro paragraph.', '```ts\nconst a = 1;\nlet b = "two";\n```', 'Between.', '```json\n{"a": [1, 2]}\n```', '```\necho plain\n```', 'Outro.'].join('\n\n');

  it.each<[string, (editor: Editor) => void]>([
    ['typing in a code block', (editor) => editor.view.dispatch(editor.state.tr.insertText(' + 1', firstCodeBlock(editor) + 12))],
    ['typing in a paragraph', (editor) => editor.view.dispatch(editor.state.tr.insertText('more ', 1))],
    ['a new line in a code block', (editor) => editor.view.dispatch(editor.state.tr.insertText('\nconst c = [];', firstCodeBlock(editor) + 13))],
    [
      'changing the language',
      (editor) => {
        editor.commands.setTextSelection(firstCodeBlock(editor) + 2);
        editor.commands.updateAttributes('codeBlock', { language: 'python' });
      },
    ],
    [
      'setting the language with an attribute step',
      (editor) => editor.view.dispatch(editor.state.tr.setNodeAttribute(firstCodeBlock(editor), 'language', 'bash')),
    ],
    [
      'a code block turned into a paragraph',
      (editor) => {
        editor.commands.setTextSelection(firstCodeBlock(editor) + 2);
        editor.commands.setParagraph();
      },
    ],
    [
      'a paragraph turned into a code block',
      (editor) => {
        editor.commands.setTextSelection(2);
        editor.commands.toggleCodeBlock();
      },
    ],
    [
      'deleting a code block',
      (editor) => {
        const at = firstCodeBlock(editor);
        const node = editor.state.doc.nodeAt(at);
        editor.view.dispatch(editor.state.tr.delete(at, at + (node?.nodeSize ?? 0)));
      },
    ],
    ['pasting a code block', (editor) => editor.commands.insertContentAt(1, '```css\n.a { color: red }\n```')],
    ['replacing the whole page', (editor) => editor.commands.setContent('```bash\nls -la\n```\n\ntext', { emitUpdate: false })],
    [
      'undo after typing in a code block',
      (editor) => {
        editor.view.dispatch(editor.state.tr.insertText('// x', firstCodeBlock(editor) + 1));
        editor.commands.undo();
      },
    ],
  ])('%s', (_name, edit) => {
    const editor = load(page);
    check(editor);
    edit(editor);
    check(editor);
  });
});

describe('comment highlights equal the previous search, once typing pauses', () => {
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  /** The previous code: one search per comment, on every update. */
  const previous = (doc: PMNode, comments: CommentMarker[], activeId: string | null) =>
    comments
      .filter((comment) => !comment.resolved)
      .flatMap((comment) => {
        const range = findQuoteRange(doc, comment.quote);
        if (!range) return [];
        return [
          {
            from: range.from,
            to: range.to,
            attrs: { class: comment.id === activeId ? 'pl-comment-highlight pl-comment-active' : 'pl-comment-highlight', 'data-comment-id': comment.id },
          },
        ];
      })
      .sort((a, b) => a.from - b.from || a.to - b.to);
  const shown = (editor: Editor) => {
    const plugin = editor.state.plugins.find((item) => (item as unknown as { key: string }).key.startsWith('nibleaf-comment-decorations$'));
    const set = (plugin?.props.decorations as (this: Plugin, state: typeof editor.state) => DecorationSet).call(plugin as Plugin, editor.state);
    return set
      .find()
      .map((decoration) => ({ from: decoration.from, to: decoration.to, attrs: (decoration as unknown as { type: { attrs: unknown } }).type.attrs }))
      .sort((a, b) => a.from - b.from || a.to - b.to);
  };

  const COMMENTS: CommentMarker[] = [
    { id: 'c1', quote: 'regular' },
    { id: 'c2', quote: 'hard-wrapped' },
    { id: 'c3', quote: 'nowhere in the page at all' },
    { id: 'c4', quote: 'alpha', resolved: true },
    { id: 'c5', quote: '  ' },
    { id: 'c6', quote: 'gamma delta' },
  ];

  it.each(PAGES)('%s, after each of 30 seeded edits and a pause', (_name, markdown) => {
    let comments = COMMENTS;
    let activeId: string | null = 'c2';
    const editor = load(markdown, { getComments: () => comments, getActiveId: () => activeId });
    expect(shown(editor)).toEqual(previous(editor.state.doc, comments, activeId));
    count('comments');
    const r = random(markdown.length + 13);
    for (let index = 0; index < 30; index += 1) {
      randomEdit(editor, r);
      vi.advanceTimersByTime(1000);
      expect(shown(editor)).toEqual(previous(editor.state.doc, comments, activeId));
      count('comments');
      if (index % 10 === 9) {
        // The comments or the focused one change: redrawn at once.
        activeId = activeId === 'c1' ? 'c6' : 'c1';
        comments = [...comments.filter((comment) => comment.id !== 'c3'), { id: `n${index}`, quote: r.pick(WORDS) }];
        editor.view.dispatch(redrawTransaction(editor.state.tr));
        expect(shown(editor)).toEqual(previous(editor.state.doc, comments, activeId));
        count('comments');
      }
    }
  });

  it('typing away from every quoted passage: the highlights move with the text, before the pause too', () => {
    const editor = load('One regular line.\n\nA hard-wrapped line, gamma delta.\n\nLast line.', {
      getComments: () => COMMENTS,
      getActiveId: () => null,
    });
    for (const text of ['a', 'b', ' c']) {
      editor.view.dispatch(editor.state.tr.insertText(text, 1));
      expect(shown(editor)).toEqual(previous(editor.state.doc, COMMENTS, null));
      count('comments');
    }
  });

  it('deleting a quoted passage removes its highlight at once', () => {
    const editor = load('One regular line.\n\nLast line.', { getComments: () => COMMENTS, getActiveId: () => null });
    const range = findQuoteRange(editor.state.doc, 'regular');
    if (!range) throw new Error('no quote');
    editor.view.dispatch(editor.state.tr.delete(range.from, range.to));
    expect(shown(editor)).toEqual(previous(editor.state.doc, COMMENTS, null));
  });

  it('a pause during an IME composition waits for it to end', () => {
    const editor = load('One regular line.', { getComments: () => COMMENTS, getActiveId: () => null });
    const view = editor.view as EditorView & { composing: boolean };
    const composing = vi.spyOn(view, 'composing', 'get').mockReturnValue(true);
    editor.view.dispatch(editor.state.tr.insertText('regular ', 1));
    vi.advanceTimersByTime(1000);
    composing.mockReturnValue(false);
    vi.advanceTimersByTime(1000);
    expect(shown(editor)).toEqual(previous(editor.state.doc, COMMENTS, null));
  });
});
