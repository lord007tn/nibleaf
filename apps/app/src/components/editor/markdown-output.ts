import type { Editor } from '@tiptap/core';
import type { Fragment, Mark, Node as PMNode } from '@tiptap/pm/model';
import { Plugin, PluginKey, type Transaction } from '@tiptap/pm/state';
import { type Mappable, ReplaceStep } from '@tiptap/pm/transform';
import { MarkdownSerializerState } from 'prosemirror-markdown';
import { Markdown } from 'tiptap-markdown';
import { normalizeLineEndings, readLineEndings, restoreLineEndings, type SourceLineEndings } from './line-endings';

/*
 * Saving a page writes its Markdown into one output buffer (#612). The serializer
 * and the editor's own node writers kept asking that buffer questions about its
 * end: does it end at a blank line (a regular expression run over the whole
 * string), what is on its last line, does it end with this paragraph's text, and
 * then cut it back with `slice`. Each question read or copied everything written
 * so far, once per block or per bold run, so a page twice as long took about four
 * times as long to save, on every autosave.
 *
 * Here the output is a list of the pieces written, in order, and each question
 * looks only at the end it is about: the last character, the current line, the
 * text written since a known length. Every piece is written once and joined once,
 * when the serializer is done. The Markdown is the same, byte for byte: each
 * method below is prosemirror-markdown's or tiptap-markdown's own, with its
 * reads of the whole output replaced by reads of its end.
 */

/** The pieces of Markdown written so far, read only from the end. */
export class MarkdownOutput {
  private pieces: string[] = [];
  /** Characters written so far. */
  length = 0;
  /** Characters read back from the output or copied out of it (`sliceFrom`,
   *  `lineStart`, the final join), so tests can bound the work (#612). */
  charactersRead = 0;

  append(text: string): void {
    if (text === '') return;
    this.pieces.push(text);
    this.length += text.length;
  }

  /** The last character written, or '' before anything is. */
  lastChar(): string {
    const last = this.pieces[this.pieces.length - 1];
    this.charactersRead += last ? 1 : 0;
    return last ? (last[last.length - 1] ?? '') : '';
  }

  /** Whether the output is empty or ends with a line break: prosemirror-markdown's `/(^|\n)$/`. */
  atLineStart(): boolean {
    return this.length === 0 || this.lastChar() === '\n';
  }

  /** What was written from `start` (a length the output had) to now. */
  sliceFrom(start: number): string {
    if (start >= this.length) return '';
    const tail: string[] = [];
    let remaining = this.length - start;
    for (let index = this.pieces.length - 1; remaining > 0; index -= 1) {
      const piece = this.pieces[index] ?? '';
      tail.push(piece.length > remaining ? piece.slice(piece.length - remaining) : piece);
      remaining -= piece.length;
    }
    this.charactersRead += this.length - start;
    return tail.reverse().join('');
  }

  /** Where the current line starts: just after the last line break, or 0. */
  lineStart(): number {
    let end = this.length;
    for (let index = this.pieces.length - 1; index >= 0; index -= 1) {
      const piece = this.pieces[index] ?? '';
      const at = piece.lastIndexOf('\n');
      this.charactersRead += at === -1 ? piece.length : piece.length - at;
      if (at !== -1) return end - piece.length + at + 1;
      end -= piece.length;
    }
    return 0;
  }

  /** The last line written, without a line break that ends it (a table writes its own):
   *  '' after a blank line or before anything is written. Only that line is read. */
  lastLine(): string {
    const end = this.lastChar() === '\n' ? this.length - 1 : this.length;
    let start = end;
    const parts: string[] = [];
    let pieceEnd = this.length;
    for (let index = this.pieces.length - 1; index >= 0 && pieceEnd > 0; index -= 1) {
      const piece = this.pieces[index] ?? '';
      const pieceStart = pieceEnd - piece.length;
      if (pieceStart < end) {
        const to = Math.min(piece.length, end - pieceStart);
        const at = piece.lastIndexOf('\n', to - 1);
        parts.push(piece.slice(at + 1, to));
        start = pieceStart + at + 1;
        if (at !== -1) break;
      }
      pieceEnd = pieceStart;
    }
    this.charactersRead += end - start;
    return parts.reverse().join('');
  }

  /** The piece holding the character at `start` (a length the output had), and where that
   *  piece starts; the piece count and the length when `start` is the end. */
  private pieceAt(start: number): { index: number; offset: number } {
    let index = this.pieces.length;
    let offset = this.length;
    while (index > 0 && offset > start) {
      index -= 1;
      offset -= this.pieces[index]?.length ?? 0;
    }
    return { index, offset };
  }

  /** What was written from `start` (a length the output had) to the next line break, or
   *  to now: only that line is read. */
  lineFrom(start: number): string {
    let { index, offset } = this.pieceAt(start);
    let at = start - offset;
    let line = '';
    for (; index < this.pieces.length; index += 1, at = 0) {
      const piece = this.pieces[index] ?? '';
      const end = piece.indexOf('\n', at);
      line += piece.slice(at, end === -1 ? piece.length : end);
      if (end !== -1) break;
    }
    this.charactersRead += line.length;
    return line;
  }

  /** Put `text` in at `start` (a length the output had), before what was written from there. */
  insertAt(start: number, text: string): void {
    if (text === '') return;
    const { index, offset } = this.pieceAt(start);
    const piece = this.pieces[index];
    if (piece === undefined) this.pieces.push(text);
    else this.pieces.splice(index, 1, ...[piece.slice(0, start - offset), text, piece.slice(start - offset)].filter(Boolean));
    this.length += text.length;
  }

  /** Cut the output back to its first `length` characters. */
  truncate(length: number): void {
    while (this.length > length) {
      const piece = this.pieces.pop() ?? '';
      this.length -= piece.length;
      if (this.length < length) {
        const kept = piece.slice(0, length - this.length);
        this.pieces.push(kept);
        this.length += kept.length;
      }
    }
  }

  /** All of it, joined once (and kept joined, so reading it again copies nothing). */
  toString(): string {
    if (this.pieces.length > 1) {
      this.charactersRead += this.length;
      this.pieces = [this.pieces.join('')];
    }
    return this.pieces[0] ?? '';
  }

  /** Replace everything written with `text`. */
  reset(text: string): void {
    this.pieces = text === '' ? [] : [text];
    this.length = text.length;
  }
}

type InlineState = { start: number; delimiter: string; end?: number };
type ScanDelims = (this: { src: string; posMax: number }, start: number, canSplitWord: boolean) => { can_open: boolean; can_close: boolean };

/** markdown-it's delimiter scan, which tiptap-markdown trims bold and italic runs with. */
const scanDelimsOf = (editor: Editor): ScanDelims => {
  const storage = editor.storage as unknown as { markdown: { parser: { md: { inline: { State: { prototype: { scanDelims: ScanDelims } } } } } } };
  return storage.markdown.parser.md.inline.State.prototype.scanDelims;
};

/*
 * tiptap-markdown's `trimInline` (src/util/markdown.js), unchanged except that it
 * runs on the end of the output that holds the run instead of all of it, and uses
 * `slice` for `substring` (every index here is non-negative, where the two agree).
 * It only changes text from the run's start on, and reads at most two characters
 * before a position it scans (a surrogate pair before the delimiter), so the
 * window starts two characters before the run.
 */
function shiftDelim(text: string, delim: string, start: number, offset: number): string {
  let res = text.slice(0, start) + text.slice(start + delim.length);
  res = res.slice(0, start + offset) + delim + res.slice(start + offset);
  return res;
}

function trimInline(scanDelims: ScanDelims, text: string, delim: string, from: number, to: number): string {
  const scan = (src: string, pos: number) => scanDelims.call({ src, posMax: src.length }, pos, true);
  let res = text;
  let start = from;
  while (start < to) {
    if (scan(res, start).can_open) break;
    res = shiftDelim(res, delim, start, 1);
    start += 1;
  }
  let end = to;
  while (end > start) {
    if (scan(res, end).can_close) break;
    res = shiftDelim(res, delim, end, -1);
    end -= 1;
  }
  if (end - start < delim.length + 1) res = res.slice(0, start) + res.slice(end + delim.length);
  return res;
}

type NodeWriters = Record<string, (state: MarkdownSerializerState, node: PMNode, parent: PMNode, index: number) => void>;
type MarkWriters = Record<string, { open: unknown; close: unknown; expelEnclosingWhitespace?: boolean }>;
type SerializerOptions = { tightLists?: boolean; hardBreakNodeName?: string; strict?: boolean };

/** prosemirror-markdown's state with the members its typings mark internal. */
interface StateInternals {
  readonly marks: MarkWriters;
  delim: string;
  closed: PMNode | null;
  atBlockStart: boolean;
  flushClose(size?: number): void;
  atBlank(): boolean;
}
const SerializerState = MarkdownSerializerState as unknown as new (
  nodes: NodeWriters,
  marks: MarkWriters,
  options: SerializerOptions,
) => MarkdownSerializerState & StateInternals;

/**
 * The serializer state the editor saves with: prosemirror-markdown's, with
 * tiptap-markdown's handling of bold and italic runs, writing into a
 * `MarkdownOutput` (see the note at the top).
 */
class LinearMarkdownSerializerState extends SerializerState {
  declare output: MarkdownOutput;
  inTable = false;
  /** The nodes being rendered, outermost first, each with its parent and index: a
   *  fence reads what comes after the containers it ends (fence-source.ts). */
  readonly path: Array<{ node: PMNode; parent: PMNode | Fragment; index: number }> = [];
  private readonly inlines: InlineState[] = [];
  private readonly scanDelims: ScanDelims;

  constructor(nodes: NodeWriters, marks: MarkWriters, options: SerializerOptions, scanDelims: ScanDelims) {
    super(nodes, marks, options);
    this.scanDelims = scanDelims;
  }

  override flushClose(size = 2): void {
    if (!this.closed) return;
    if (!this.atBlank()) this.output.append('\n');
    if (size > 1) {
      let delimMin = this.delim;
      const trim = /\s+$/.exec(delimMin);
      if (trim) delimMin = delimMin.slice(0, delimMin.length - trim[0].length);
      for (let i = 1; i < size; i++) this.output.append(`${delimMin}\n`);
    }
    this.closed = null;
  }

  override atBlank(): boolean {
    return this.output.atLineStart();
  }

  override ensureNewLine(): void {
    if (!this.atBlank()) this.output.append('\n');
  }

  override write(content?: string): void {
    this.flushClose();
    if (this.delim && this.atBlank()) this.output.append(this.delim);
    if (content) this.output.append(content);
  }

  override text(text: string, shouldEscape = true): void {
    const lines = text.split('\n');
    for (let i = 0; i < lines.length; i++) {
      this.write();
      const line = lines[i] ?? '';
      // Escape exclamation marks in front of links: prosemirror-markdown's `/(^|[^\\])\!$/`.
      if (!shouldEscape && line[0] === '[') {
        const end = this.output.sliceFrom(Math.max(0, this.output.length - 2));
        if (end.endsWith('!') && (end.length === 1 || end[0] !== '\\')) {
          this.output.truncate(this.output.length - 1);
          this.output.append('\\!');
        }
      }
      this.output.append(shouldEscape ? this.esc(line, this.atBlockStart) : line);
      if (i !== lines.length - 1) this.output.append('\n');
    }
  }

  // tiptap-markdown's MarkdownSerializerState (src/serialize/state.js) from here on.
  override render(node: PMNode, parent: PMNode, index: number): void {
    this.path.push({ node, parent, index });
    try {
      super.render(node, parent, index);
    } finally {
      this.path.pop();
    }
    const top = this.inlines[this.inlines.length - 1];
    // A run that starts at position 0 is never trimmed there either.
    if (top?.start && top.end) {
      let start = top.start;
      const window = Math.max(0, start - 2);
      const text = this.output.sliceFrom(window);
      while (/\s/.test(text.charAt(start - window))) start += 1;
      const trimmed = trimInline(this.scanDelims, text, top.delimiter, start - window, top.end - window);
      if (trimmed !== text) {
        this.output.truncate(window);
        this.output.append(trimmed);
      }
      this.inlines.pop();
    }
  }

  override markString(mark: Mark, open: boolean, parent: PMNode, index: number): string {
    const info = this.marks[mark.type.name];
    if (info?.expelEnclosingWhitespace) {
      if (open) this.inlines.push({ start: this.output.length, delimiter: String(info.open) });
      else {
        const top = this.inlines.pop();
        this.inlines.push({ ...(top as InlineState), end: this.output.length });
      }
    }
    return super.markString(mark, open, parent, index);
  }
}

// `out` is prosemirror-markdown's whole output. Reading it joins the pieces once;
// the base constructor assigns it before this class's fields exist.
Object.defineProperty(LinearMarkdownSerializerState.prototype, 'out', {
  configurable: true,
  get(this: LinearMarkdownSerializerState): string {
    return this.output.toString();
  },
  set(this: LinearMarkdownSerializerState, value: string) {
    this.output ??= new MarkdownOutput();
    this.output.reset(value);
  },
});

type MarkdownSerializerLike = {
  nodes: NodeWriters;
  marks: MarkWriters;
  serialize(content: PMNode | Fragment): string;
};

type MarkdownStorageLike = {
  serializer: MarkdownSerializerLike;
  getMarkdown(): string;
  /** The line endings of the Markdown the document was last set from (line-endings.ts). */
  lineEndings: SourceLineEndings | null;
};

type SetContent = (content: unknown, ...rest: unknown[]) => (props: { editor: Editor }) => boolean;

const markdownStorage = (editor: Editor) => (editor.storage as unknown as { markdown: MarkdownStorageLike }).markdown;
const lineEndingsKey = new PluginKey('markdownLineEndings');

// keyboardShortcut() replays mapped steps, without transaction metadata. Keep
// the source on the replacement too. Inversion/merging and JSON serialization
// remain ordinary ReplaceSteps, so undo/redo keep the latest setContent source.
class LineEndingsReplaceStep extends ReplaceStep {
  readonly lineEndings: SourceLineEndings | null;

  constructor(step: ReplaceStep, lineEndings: SourceLineEndings | null) {
    super(step.from, step.to, step.slice);
    this.lineEndings = lineEndings;
  }

  override map(mapping: Mappable): ReplaceStep | null {
    const mapped = super.map(mapping);
    return mapped && new LineEndingsReplaceStep(mapped, this.lineEndings);
  }
}

/** tiptap-markdown, saving with `LinearMarkdownSerializerState`. Its serializer
 *  builds its own state class; this one is the same with the output kept as pieces.
 *  A page is read with LF line endings and saved with its own (line-endings.ts). */
export const LinearMarkdown = Markdown.extend({
  addCommands() {
    const commands = (this.parent?.() ?? {}) as { setContent?: SetContent };
    const setContent = commands.setContent as SetContent;
    return {
      ...commands,
      // Markdown set as the document (a page load, a re-seed) is read with LF, and
      // its endings are kept for the save. Anything else set has no source to keep.
      // Keep the new source on the transaction: a chain can have `dispatch`
      // without ever being run, so assembling it must not change the page.
      setContent:
        (content: unknown, ...rest: unknown[]) =>
        (props: { editor: Editor; dispatch?: unknown; tr: Transaction }) => {
          const markdown = typeof content === 'string';
          const start = props.tr.steps.length;
          const result = setContent(markdown ? normalizeLineEndings(content) : content, ...rest)(props);
          if (result && props.dispatch) {
            const endings = markdown ? readLineEndings(content) : null;
            props.tr.setMeta(lineEndingsKey, endings);
            for (let index = start; index < props.tr.steps.length; index++) {
              const step = props.tr.steps[index];
              if (step instanceof ReplaceStep) props.tr.steps[index] = new LineEndingsReplaceStep(step, endings);
            }
          }
          return result;
        },
    } as never;
  },
  addProseMirrorPlugins() {
    return [
      ...(this.parent?.() ?? []),
      new Plugin({
        key: lineEndingsKey,
        appendTransaction: (transactions) => {
          // Runs only for applied transactions, before update listeners save,
          // including silent setContent and replacements with an equal document.
          for (const transaction of transactions) {
            const endings = transaction.getMeta(lineEndingsKey) as SourceLineEndings | null | undefined;
            if (endings !== undefined) markdownStorage(this.editor).lineEndings = endings;
            for (const step of transaction.steps) {
              if (step instanceof LineEndingsReplaceStep) markdownStorage(this.editor).lineEndings = step.lineEndings;
            }
          }
          return null;
        },
      }),
    ];
  },
  onBeforeCreate(event) {
    // The editor's first content, when it is Markdown, is read the same way.
    const { content } = this.editor.options;
    const lineEndings = typeof content === 'string' ? readLineEndings(content) : null;
    if (typeof content === 'string') this.editor.options.content = normalizeLineEndings(content);
    this.parent?.(event);
    const storage = markdownStorage(this.editor);
    storage.lineEndings = lineEndings;
    const { serializer } = storage;
    const scanDelims = scanDelimsOf(this.editor);
    serializer.serialize = (content) => {
      const state = new LinearMarkdownSerializerState(serializer.nodes, serializer.marks, { hardBreakNodeName: 'hardBreak' }, scanDelims);
      state.renderContent(content as PMNode);
      return state.output.toString();
    };
    // Only the whole page is saved with the source's endings; a copied slice keeps LF.
    storage.getMarkdown = () => restoreLineEndings(storage.lineEndings, serializer.serialize(this.editor.state.doc));
  },
});
