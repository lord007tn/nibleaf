/*
 * A seeded corpus of editor documents for the serializer differential (#612):
 * pages built from the shapes the save path handles specially (fences in lists,
 * quotes and components, hard-wrapped paragraphs, MDX components, tables, nested
 * containers, RTL text), each loaded into the editor and, for most, edited the
 * way a writer would before it is saved. The same seed always gives the same
 * pages and edits, so main's output for each can be recorded once and compared
 * byte for byte (serializer-differential.generate.mjs).
 */

export const SERIALIZER_CORPUS_SEED = 0x6_12_5e_ed;
export const SERIALIZER_CORPUS_SIZE = 1000;

/** An edit applied to the loaded page before it is saved, at positions picked from the seed. */
export type CorpusEdit =
  | { kind: 'insert'; at: number; text: string }
  | { kind: 'bold' | 'italic' | 'strike' | 'code' | 'delete'; from: number; length: number }
  | { kind: 'split'; at: number }
  | { kind: 'language'; index: number; language: string };

export interface CorpusCase {
  index: number;
  source: string;
  edits: CorpusEdit[];
}

/** mulberry32: small, fast and the same everywhere. */
function random(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d_2b_79_f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4_294_967_296;
  };
}

const WORDS = [
  'the',
  'page',
  'editor',
  'saves',
  'Markdown',
  'with',
  '**bold**',
  '*italic*',
  '~~gone~~',
  '`code`',
  '[a link](/guide)',
  '[external](https://example.com/a_b)',
  'snake_case_name',
  'a*b',
  'tab\there',
  // A `!` right before a link, which the serializer escapes, and an image after a word.
  'Wow\\![a link](/x)',
  'See![an image](/x.png)',
  '**bold at the end**',
  'دليل',
  // Astral characters, which markdown-it reads as surrogate pairs around a delimiter.
  '🚀',
  '**🚀**',
  'المحرر',
  'يحفظ',
  'الصفحة',
  '<kbd>K</kbd>',
  '{value}',
  '2 < 3',
  'x_y_z',
  '#hash',
  '\\*escaped\\*',
];
const LANGUAGES = ['js', 'ts', 'bash', 'md', 'python', ''];

export function serializerCorpus(seed = SERIALIZER_CORPUS_SEED, size = SERIALIZER_CORPUS_SIZE): CorpusCase[] {
  const next = random(seed);
  const pick = <T>(items: readonly T[]): T => items[Math.floor(next() * items.length)] as T;
  const chance = (p: number) => next() < p;
  const words = (count: number) => Array.from({ length: count }, () => pick(WORDS)).join(' ');

  const wrapped = () => {
    const lines = Array.from({ length: 1 + Math.floor(next() * 4) }, () => words(3 + Math.floor(next() * 6)));
    // A hard break (two spaces or a backslash) now and then.
    return lines.map((line, i) => (i < lines.length - 1 && chance(0.1) ? `${line}${pick(['  ', '\\'])}` : line)).join('\n');
  };
  const fence = (depth: number): string => {
    const marker = pick(['```', '~~~', '````']);
    const indent = chance(0.2) ? pick([' ', '  ', '\t']) : '';
    const body = Array.from({ length: Math.floor(next() * 4) }, () =>
      pick(['const a = 1;', '\tindented', '', '  two', '<Card title="x" />', '| a | b |', '```']),
    ).join('\n');
    const closer = chance(0.1) ? `${marker}\`` : marker;
    const open = `${indent}${marker}${pick(LANGUAGES)}${chance(0.1) ? ' title="x"' : ''}`;
    return depth === 0 && chance(0.05) ? `${open}\n${body}` : `${open}\n${body}${body ? '\n' : ''}${indent}${closer}`;
  };
  const table = () => {
    const columns = 1 + Math.floor(next() * 3);
    const row = () => `| ${Array.from({ length: columns }, () => pick(['a', 'b \\| c', '**x**', '`y`', 'دليل', ''])).join(' | ')} |`;
    const delimiter = `| ${Array.from({ length: columns }, () => pick(['---', ':---', ':---:', '---:'])).join(' | ')} |`;
    return [row(), delimiter, ...Array.from({ length: 1 + Math.floor(next() * 3) }, row)].join('\n');
  };
  const indentLines = (text: string, first: string, rest: string) =>
    text
      .split('\n')
      .map((line, i) => (i === 0 ? first : line === '' ? '' : rest) + line)
      .join('\n');

  const block = (depth: number): string => {
    const roll = next();
    if (depth < 3 && roll < 0.12) {
      // A list: bullet, ordered or task, tight or loose, items holding blocks.
      const ordered = chance(0.3);
      const task = !ordered && chance(0.2);
      const loose = chance(0.3);
      const start = ordered ? pick([1, 3, 10]) : 0;
      const items = Array.from({ length: 1 + Math.floor(next() * 3) }, (_, i) => {
        const marker = ordered ? `${start + i}. ` : task ? `- [${pick([' ', 'x'])}] ` : `${pick(['-', '*', '+'])} `;
        const body = chance(0.25) ? fence(depth + 1) : [block(depth + 1), ...(chance(0.3) ? [block(depth + 1)] : [])].join('\n\n');
        return indentLines(body, marker, ' '.repeat(marker.length));
      });
      return items.join(loose ? '\n\n' : '\n');
    }
    if (depth < 3 && roll < 0.2) {
      const inner = [block(depth + 1), ...(chance(0.4) ? [block(depth + 1)] : [])].join('\n\n');
      return indentLines(inner, '> ', '> ').replace(/^> $/gm, '>');
    }
    if (depth < 3 && roll < 0.3) {
      const inner = [block(depth + 1), ...(chance(0.4) ? [fence(depth + 1)] : [])].join('\n\n');
      return pick([
        `<Note>\n\n${inner}\n\n</Note>`,
        `<Card title="${pick(['Start', 'ابدأ', 'A & B'])}" icon="rocket">\n\n${inner}\n\n</Card>`,
        `<Steps>\n<Step title="One">\n\n${inner}\n\n</Step>\n<Step title="Two">\n\n${words(4)}\n\n</Step>\n</Steps>`,
        `<Tabs>\n<Tab title="A">\n\n${inner}\n\n</Tab>\n</Tabs>`,
        `<AccordionGroup>\n<Accordion title="Q">\n\n${inner}\n\n</Accordion>\n</AccordionGroup>`,
        `<CodeGroup>\n\n${fence(depth + 1)}\n\n${fence(depth + 1)}\n\n</CodeGroup>`,
        `> [!${pick(['NOTE', 'TIP', 'WARNING'])}]\n${indentLines(inner, '> ', '> ').replace(/^> $/gm, '>')}`,
        `<Callout type="info">\n\n${inner}\n\n</Callout>`,
      ]);
    }
    if (roll < 0.45) return fence(depth);
    if (roll < 0.52) return table();
    if (roll < 0.58) return `${'#'.repeat(1 + Math.floor(next() * 3))} ${words(2 + Math.floor(next() * 3))}`;
    if (roll < 0.62)
      return pick([
        '![A diagram](https://example.com/a.png)',
        '<img src="https://example.com/b.png" alt="B" width="200" />',
        '---',
        '<Foo bar="1" />',
        '<div class="x">\n<p>raw</p>\n</div>',
        '<!-- a comment -->',
        '<iframe src="https://www.youtube.com/embed/abcdefghijk"></iframe>',
        'Inline <Tooltip tip="hi">word</Tooltip> and <Icon icon="star" /> here.',
        '$$\nx^2\n$$',
      ]);
    return wrapped();
  };

  const cases: CorpusCase[] = [];
  for (let index = 0; index < size; index++) {
    const blocks = Array.from({ length: 1 + Math.floor(next() * 8) }, () => block(0));
    const source = blocks.join(pick(['\n\n', '\n\n', '\n\n\n'])) + pick(['', '\n', '\n\n']);
    const edits: CorpusEdit[] = [];
    // About a third of the pages are saved as loaded; the rest get one to three edits.
    const count = chance(0.33) ? 0 : 1 + Math.floor(next() * 3);
    for (let e = 0; e < count; e++) {
      const kind = pick(['insert', 'insert', 'bold', 'italic', 'strike', 'code', 'delete', 'split', 'language'] as const);
      const at = next();
      if (kind === 'insert')
        edits.push({ kind, at: Math.floor(at * 1e6), text: pick(['x', ' ', 'new words', '**', '[', '!', 'دليل', '\\', '`', '|']) });
      else if (kind === 'split') edits.push({ kind, at: Math.floor(at * 1e6) });
      else if (kind === 'language') edits.push({ kind, index: Math.floor(at * 1e6), language: pick(LANGUAGES) });
      else edits.push({ kind, from: Math.floor(at * 1e6), length: 1 + Math.floor(next() * 12) });
    }
    cases.push({ index, source, edits });
  }
  return cases;
}

/** The editor surface the differential drives: `buildEditorExtensions` and friends from tiptap-editor.tsx. */
export interface DifferentialEditor {
  commands: {
    setContent(content: string, options?: { emitUpdate?: boolean }): boolean;
    setTextSelection(position: number | { from: number; to: number }): boolean;
    insertContent(content: string): boolean;
    toggleBold(): boolean;
    toggleItalic(): boolean;
    toggleStrike(): boolean;
    toggleCode(): boolean;
    deleteSelection(): boolean;
    splitBlock(): boolean;
    updateAttributes(type: string, attributes: Record<string, unknown>): boolean;
  };
  state: {
    doc: {
      content: { size: number };
      descendants(
        f: (node: { isText: boolean; isTextblock: boolean; nodeSize: number; type: { name: string } }, pos: number) => boolean | undefined,
      ): void;
    };
  };
}

/** Text positions in the document, in order: where an edit can land. */
function textPositions(editor: DifferentialEditor): number[] {
  const positions: number[] = [];
  editor.state.doc.descendants((node, pos) => {
    if (node.isText) for (let offset = 0; offset <= node.nodeSize; offset++) positions.push(pos + offset);
    return true;
  });
  return positions;
}

/** Apply `edits` the way the editor's commands would for a writer. An edit that
 *  can't apply where it lands (no text, a node that refuses it) is skipped. */
export function applyCorpusEdits(editor: DifferentialEditor, edits: readonly CorpusEdit[]): void {
  for (const edit of edits) {
    const positions = textPositions(editor);
    if (positions.length === 0) return;
    try {
      if (edit.kind === 'language') {
        const blocks: number[] = [];
        editor.state.doc.descendants((node, pos) => {
          if (node.type.name === 'codeBlock') blocks.push(pos + 1);
          return true;
        });
        const at = blocks[edit.index % Math.max(1, blocks.length)];
        if (at === undefined) continue;
        editor.commands.setTextSelection(at);
        editor.commands.updateAttributes('codeBlock', { language: edit.language || null });
        continue;
      }
      if (edit.kind === 'insert' || edit.kind === 'split') {
        editor.commands.setTextSelection(positions[edit.at % positions.length] as number);
        if (edit.kind === 'insert') editor.commands.insertContent(edit.text);
        else editor.commands.splitBlock();
        continue;
      }
      const startIndex = edit.from % positions.length;
      const from = positions[startIndex] as number;
      const to = positions[Math.min(positions.length - 1, startIndex + edit.length)] as number;
      if (to <= from) continue;
      editor.commands.setTextSelection({ from, to });
      if (edit.kind === 'bold') editor.commands.toggleBold();
      else if (edit.kind === 'italic') editor.commands.toggleItalic();
      else if (edit.kind === 'strike') editor.commands.toggleStrike();
      else if (edit.kind === 'code') editor.commands.toggleCode();
      else editor.commands.deleteSelection();
    } catch {
      // Positions inside atoms and node views can refuse a selection; the page is saved as it is.
    }
  }
}
