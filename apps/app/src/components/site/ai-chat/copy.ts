import type { AiChatSource } from '@nibleaf/validators';
import { fromMarkdown } from 'mdast-util-from-markdown';
import type { CitedSection } from './sources';

/*
 * What "Copy answer" puts on the clipboard. Readers paste answers into chat,
 * email, tickets and docs, so the copy reads like the answer on screen:
 * citations are the numbers the reader sees ([1], [2]), never the model's ids
 * ([S3]), and they end in a numbered list of the sources with their links.
 *
 * - text/plain keeps what chat tools render (list numbers, `code`, fenced code)
 *   and drops what they show as clutter (**bold** and *emphasis* markers, #
 *   heading marks). Code is never changed.
 * - text/html is the answer as rendered, for editors that paste rich text.
 */

/** A run of citation markers (`[S1]`, `[S1, S2][S3]`), with one optional space
 * before it. Every repetition starts at a literal bracket, so matching is linear. */
const MARKER_RUN = / ?(?:\[S\d+(?:[ \t]*[,;،؛][ \t]*S\d+)*\])+/g;

/** `[1][2]` for the sections a run cites, in order and without repeats; nothing
 * when it cites none the answer lists. */
const numbers = (run: string, numberOf: (id: string) => number | undefined) => {
  const seen = new Set<number>();
  for (const id of run.match(/S\d+/g) ?? []) {
    const number = numberOf(id);
    if (number !== undefined) seen.add(number);
  }
  return seen.size ? ` ${[...seen].map((number) => `[${number}]`).join('')}` : '';
};

/** The parts of a Markdown (mdast) node this module reads. */
interface MarkdownNode {
  type: string;
  children?: MarkdownNode[];
  position?: { start: { offset?: number }; end: { offset?: number } };
}
/** Nodes whose text is shown exactly as written: inline, indented and fenced code, and raw HTML. */
const VERBATIM = new Set(['inlineCode', 'code', 'html']);
/** Nodes whose delimiters (`**`, `*`, `#`, a setext underline) are dropped, keeping what they hold. */
const DELIMITED = new Set(['strong', 'emphasis', 'heading']);
const offsets = (node: MarkdownNode | undefined) => {
  const start = node?.position?.start.offset;
  const end = node?.position?.end.offset;
  return start === undefined || end === undefined ? undefined : { start, end };
};

/** The checked answer as clean text: numbered citations, no emphasis or heading
 * marks. It reads the answer with the same CommonMark parse the panel renders, and
 * edits only the source of the nodes it changes, so code (inline, indented, or
 * fenced, at any depth) and everything else keep their exact text. */
export function plainAnswer(answer: string, numberOf: (id: string) => number | undefined): string {
  const edits: { start: number; end: number; text: string }[] = [];
  const visit = (node: MarkdownNode) => {
    if (VERBATIM.has(node.type)) return;
    const own = offsets(node);
    if (node.type === 'text' && own) {
      const source = answer.slice(own.start, own.end);
      for (const run of source.matchAll(MARKER_RUN))
        edits.push({ start: own.start + run.index, end: own.start + run.index + run[0].length, text: numbers(run[0], numberOf) });
      return;
    }
    const children = node.children ?? [];
    const first = offsets(children[0]);
    const last = offsets(children.at(-1));
    if (DELIMITED.has(node.type) && own && first && last) {
      edits.push({ start: own.start, end: first.start, text: '' }, { start: last.end, end: own.end, text: '' });
    }
    for (const child of children) visit(child);
  };
  visit(fromMarkdown(answer) as MarkdownNode);
  // The edited ranges never overlap: a node's delimiters lie outside its children.
  let text = answer;
  for (const { start, end, text: replacement } of edits.sort((a, b) => b.start - a.start))
    text = text.slice(0, start) + replacement + text.slice(end);
  return text.trim();
}

export interface CopyLabels {
  /** "Sources" */
  sources: string;
  /** The name of a citation of a page's top, which has no section heading. */
  top: string;
}

/** "Page › Section", the name a source has in the list on screen. */
const sourceName = (source: AiChatSource, labels: Pick<CopyLabels, 'top'>) => `${source.title} › ${source.heading ?? labels.top}`;

/** The answer as clean text, then its sources: `[n] Page › Section` and the link. */
export function plainCopy(
  answer: string,
  sections: readonly CitedSection[],
  numberOf: (id: string) => number | undefined,
  link: (source: AiChatSource) => string,
  labels: CopyLabels,
): string {
  const body = plainAnswer(answer, numberOf);
  if (!sections.length) return body;
  const list = sections.map(({ number, source }) => `[${number}] ${sourceName(source, labels)}\n${link(source)}`);
  return `${body}\n\n${labels.sources}\n${list.join('\n')}`;
}

/** Attributes kept in copied HTML: text direction, and where a numbered list starts. */
const keptAttribute = (element: Element, name: string, value: string) =>
  name === 'dir' || (name === 'start' && element.tagName === 'OL' && /^\d{1,9}$/.test(value));

/** The rendered answer as HTML: each citation becomes its `[n]`, attributes are
 * dropped (except `dir`, for right-to-left answers, and a list's numeric `start`,
 * so a list that starts at 3 still does), and the sources follow as linked lines.
 * Built with DOM nodes, never from strings. */
export function htmlCopy(answer: HTMLElement, sections: readonly CitedSection[], link: (source: AiChatSource) => string, labels: CopyLabels): string {
  const root = document.createElement('div');
  const direction = answer.closest('[dir]')?.getAttribute('dir');
  if (direction) root.setAttribute('dir', direction);
  const body = answer.cloneNode(true) as HTMLElement;
  // One space before a run of citations (`[1][2]`, as in plain text), whether or
  // not the text before it already ends in one.
  const numbers = new WeakSet<Node>();
  for (const citation of body.querySelectorAll('[data-citation]')) {
    const before = citation.previousSibling;
    const joined = before !== null && (numbers.has(before) || /\s$/.test(before.textContent ?? ''));
    const number = document.createTextNode(`${joined ? '' : ' '}[${citation.getAttribute('data-citation')}]`);
    numbers.add(number);
    citation.replaceWith(number);
  }
  for (const element of [body, ...body.querySelectorAll('*')]) {
    for (const { name, value } of [...element.attributes]) if (!keptAttribute(element, name, value)) element.removeAttribute(name);
  }
  root.append(...body.childNodes);
  if (sections.length) {
    const heading = document.createElement('p');
    const strong = document.createElement('strong');
    strong.textContent = labels.sources;
    heading.append(strong);
    root.append(heading);
    for (const { number, source } of sections) {
      const line = document.createElement('p');
      const anchor = document.createElement('a');
      anchor.href = link(source);
      anchor.textContent = sourceName(source, labels);
      line.append(`[${number}] `, anchor);
      root.append(line);
    }
  }
  return root.outerHTML;
}

/** Copies through the browser's copy command, for pages without the async
 * clipboard (sites served over plain http, older browsers). The text is selected in
 * a hidden field next to the control that has focus (inside the chat dialog, whose
 * focus trap would otherwise take focus back), and the copy event also sets the
 * HTML. Focus and the reader's own selection are put back afterwards. */
function copyWithCommand(plain: string, html?: string): boolean {
  if (typeof document.execCommand !== 'function') return false;
  const active = document.activeElement instanceof HTMLElement ? document.activeElement : null;
  const selection = document.getSelection();
  const ranges = selection ? Array.from({ length: selection.rangeCount }, (_, index) => selection.getRangeAt(index).cloneRange()) : [];
  const field = document.createElement('textarea');
  field.value = plain;
  field.readOnly = true;
  field.setAttribute('aria-hidden', 'true');
  field.tabIndex = -1;
  field.style.cssText = 'position:fixed;top:0;left:0;width:1px;height:1px;padding:0;border:0;opacity:0;pointer-events:none';
  const onCopy = (event: ClipboardEvent) => {
    if (!event.clipboardData) return;
    event.clipboardData.setData('text/plain', plain);
    if (html) event.clipboardData.setData('text/html', html);
    event.preventDefault();
  };
  (active?.closest('[role="dialog"]') ?? document.body).append(field);
  document.addEventListener('copy', onCopy, true);
  try {
    field.focus({ preventScroll: true });
    field.select();
    return document.execCommand('copy');
  } catch {
    return false;
  } finally {
    document.removeEventListener('copy', onCopy, true);
    field.remove();
    // Focus first: moving focus can reset the selection.
    active?.focus({ preventScroll: true });
    if (selection) {
      selection.removeAllRanges();
      for (const range of ranges) selection.addRange(range);
    }
  }
}

/** Writes both flavors where the browser can, plain text where only that works,
 * and falls back to the copy command where there is no async clipboard (plain
 * http) or it refuses. Rejects only when nothing could be copied. */
export async function writeCopy(plain: string, html?: string): Promise<void> {
  const clipboard: Partial<Clipboard> | undefined = typeof navigator === 'undefined' ? undefined : navigator.clipboard;
  if (html && typeof ClipboardItem !== 'undefined' && typeof clipboard?.write === 'function') {
    try {
      await clipboard.write([
        new ClipboardItem({ 'text/plain': new Blob([plain], { type: 'text/plain' }), 'text/html': new Blob([html], { type: 'text/html' }) }),
      ]);
      return;
    } catch {
      // Some browsers refuse rich clipboard writes; plain text may still work.
    }
  }
  if (typeof clipboard?.writeText === 'function') {
    try {
      await clipboard.writeText(plain);
      return;
    } catch {
      // Refused (no permission, or the page lost focus): try the copy command.
    }
  }
  if (!copyWithCommand(plain, html)) throw new Error('Copy unavailable');
}
