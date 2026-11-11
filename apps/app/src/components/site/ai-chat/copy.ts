import type { AiChatSource } from '@nibleaf/validators';
import type { CitedSection } from './sources';

/*
 * What "Copy answer" puts on the clipboard. Readers paste answers into chat,
 * email, tickets and docs, so the copy reads like the answer on screen:
 * citations are the numbers the reader sees ([1], [2]), never the model's ids
 * ([S3]), and they end in a numbered list of the sources with their links.
 *
 * - text/plain keeps what chat tools render (list numbers, `code`, fenced code)
 *   and drops what they show as clutter (**bold** markers, # heading marks).
 * - text/html is the answer as rendered, for editors that paste rich text.
 */

/** A run of citation markers (`[S1]`, `[S1, S2][S3]`), with one optional space
 * before it. Every repetition starts at a literal bracket, so matching is linear. */
const MARKER_RUN = / ?(?:\[S\d+(?:[ \t]*[,;،؛][ \t]*S\d+)*\])+/g;
const FENCE = /^\s{0,3}(`{3,}|~{3,})/;
const HEADING = /^\s{0,3}#{1,6}[ \t]+/;
const CLOSING_HASHES = /[ \t]+#+[ \t]*$/;

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

/** Removes `**` emphasis outside inline code, scanning once. */
const withoutBold = (line: string) =>
  line
    .split('`')
    .map((part, index) => (index % 2 === 0 ? part.replaceAll('**', '') : part))
    .join('`');

/** The checked answer as clean text: numbered citations, no bold or heading
 * marks. Fenced code is kept exactly as written. */
export function plainAnswer(answer: string, numberOf: (id: string) => number | undefined): string {
  let fence = '';
  return answer
    .split('\n')
    .map((line) => {
      const marker = FENCE.exec(line)?.[1];
      if (marker) {
        if (!fence) fence = marker;
        else if (marker[0] === fence[0] && marker.length >= fence.length) fence = '';
        return line;
      }
      if (fence) return line;
      let text = line.replace(MARKER_RUN, (run) => numbers(run, numberOf));
      if (HEADING.test(text)) text = text.replace(HEADING, '').replace(CLOSING_HASHES, '');
      return withoutBold(text);
    })
    .join('\n')
    .trim();
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

/** The rendered answer as HTML: each citation becomes its `[n]`, attributes are
 * dropped (only `dir` is kept, for right-to-left answers), and the sources follow
 * as linked lines. Built with DOM nodes, never from strings. */
export function htmlCopy(answer: HTMLElement, sections: readonly CitedSection[], link: (source: AiChatSource) => string, labels: CopyLabels): string {
  const root = document.createElement('div');
  const direction = answer.closest('[dir]')?.getAttribute('dir');
  if (direction) root.setAttribute('dir', direction);
  const body = answer.cloneNode(true) as HTMLElement;
  for (const citation of body.querySelectorAll('[data-citation]')) citation.replaceWith(` [${citation.getAttribute('data-citation')}]`);
  for (const element of [body, ...body.querySelectorAll('*')]) {
    for (const { name } of [...element.attributes]) if (name !== 'dir') element.removeAttribute(name);
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

/** Writes both flavors where the browser can, and plain text otherwise. */
export async function writeCopy(plain: string, html?: string): Promise<void> {
  if (html && typeof ClipboardItem !== 'undefined' && typeof navigator.clipboard.write === 'function') {
    try {
      await navigator.clipboard.write([
        new ClipboardItem({ 'text/plain': new Blob([plain], { type: 'text/plain' }), 'text/html': new Blob([html], { type: 'text/html' }) }),
      ]);
      return;
    } catch {
      // Some browsers refuse rich clipboard writes; plain text still works.
    }
  }
  await navigator.clipboard.writeText(plain);
}
