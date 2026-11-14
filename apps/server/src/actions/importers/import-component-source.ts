import { readImportComponentTag } from './import-markdown-code';
import type { ImportReference } from './import-references';

interface ComponentTag {
  start: number;
  end: number;
  name: string;
  closing: boolean;
  selfClosing: boolean;
  complete: boolean;
  block: boolean;
}

/** The converter's tolerant MDX tokenizer, with a source map for one Markdown parse. */
export const componentMarkdownSource = (source: string, resources: readonly ImportReference[]) => {
  const tags: ComponentTag[] = [];
  const opaque: Array<{ start: number; end: number }> = [];
  const removed: Array<{ start: number; end: number }> = [];
  const remove = (start: number, end: number) => {
    if (end <= start) return;
    const last = removed.at(-1);
    if (last && start <= last.end) last.end = Math.max(last.end, end);
    else removed.push({ start, end });
  };
  let resourceIndex = 0;
  let cursor = 0;
  let newline = source.indexOf('\n');
  let lowerSource: string | undefined;
  while (cursor < source.length) {
    const start = source.indexOf('<', cursor);
    if (start < 0) break;
    if (source.startsWith('<!--', start)) {
      const end = source.indexOf('-->', start + 4);
      cursor = end < 0 ? source.length : end + 3;
      continue;
    }
    let escaped = start;
    while (source[escaped - 1] === '\\') escaped--;
    if ((start - escaped) % 2) {
      cursor = start + 1;
      continue;
    }
    const name = /^<(\/?)([A-Za-z][\w.:-]*)/.exec(source.slice(start, start + 128));
    if (!name?.[2]) {
      cursor = start + 1;
      continue;
    }
    const tag = readImportComponentTag(source, start);
    if (newline >= 0 && newline < start) newline = source.indexOf('\n', start);
    const end = tag.complete ? tag.end : Math.min(tag.end, newline < 0 ? source.length : newline);
    cursor = Math.max(start + 1, end);
    // A tag-shaped angle URL is still a destination, not a component.
    while (resources[resourceIndex] && (resources[resourceIndex]?.end ?? 0) <= start) resourceIndex++;
    const resource = resources[resourceIndex];
    if (resource && resource.start < end && resource.end > start) continue;
    const element = name[2];
    if (['script', 'style', 'textarea', 'title', 'pre', 'code'].includes(element.toLowerCase())) {
      // Opaque HTML content is not MDX children.
      lowerSource ??= source.toLowerCase();
      const closer = `</${element.toLowerCase()}`;
      let closing = lowerSource.indexOf(closer, cursor);
      while (closing >= 0 && !/[\s>]/.test(source[closing + closer.length] ?? '')) {
        closing = lowerSource.indexOf(closer, closing + closer.length);
      }
      opaque.push({ start: tag.end, end: closing < 0 ? source.length : closing });
      cursor = closing < 0 ? source.length : readImportComponentTag(source, closing).end;
      continue;
    }
    let preceding = start;
    while (preceding > 0 && /[\s>]/.test(source[preceding - 1] ?? '')) preceding--;
    if (source.slice(preceding - 2, preceding) === ']:') continue;
    let prefix = start;
    while (prefix > 0 && /[\t >]/.test(source[prefix - 1] ?? '')) prefix--;
    const previous = tags.at(-1);
    const block = prefix === 0 || /[\r\n]/.test(source[prefix - 1] ?? '') || (previous?.block === true && previous.end === start);
    tags.push({
      start,
      end,
      name: element,
      closing: Boolean(name[1]),
      selfClosing: tag.selfClosing || /^(?:area|base|br|col|embed|hr|img|input|link|meta|param|source|track|wbr)$/i.test(element),
      complete: tag.complete,
      block,
    });
  }

  const stack: Array<{ name: string; indent: number }> = [];
  let tagIndex = 0;
  for (const line of source.matchAll(/[^\r\n]*(?:\r\n|\r|\n)|[^\r\n]+$/g)) {
    const start = line.index;
    const indent = /^ */.exec(line[0])?.[0].length ?? 0;
    remove(start, start + Math.min(indent, stack.at(-1)?.indent ?? 0));
    while (tags[tagIndex] && (tags[tagIndex]?.start ?? source.length) < start + line[0].length) {
      const tag = tags[tagIndex++];
      if (!tag) continue;
      // Inline HTML already exposes Markdown children. Leave it in the parse
      // view so removing a tag cannot manufacture valid link/definition syntax.
      if (tag.block) remove(tag.start, tag.end);
      if (tag.closing) {
        if (stack.at(-1)?.name === tag.name) stack.pop();
      } else if (!tag.selfClosing) stack.push({ name: tag.name, indent: indent + 2 });
    }
  }

  // Do not feed enormous malformed paragraphs to micromark. They contain no
  // destination spans; retain their exact bytes outside the parsing view.
  const huge: Array<{ start: number; end: number }> = [];
  let paragraphStart = 0;
  let candidate = 0;
  const inspect = (end: number) => {
    if (end - paragraphStart > 64 * 1024) {
      while (resources[candidate] && (resources[candidate]?.end ?? 0) <= paragraphStart) candidate++;
      const reference = resources[candidate];
      const text = source.slice(paragraphStart, end);
      if ((!reference || reference.start >= end) && !text.includes(']:') && !text.includes('![') && !text.includes('href')) {
        huge.push({ start: paragraphStart, end });
      }
    }
    paragraphStart = end;
  };
  for (const blank of source.matchAll(/\r?\n[\t ]*\r?\n/g)) inspect(blank.index + blank[0].length);
  inspect(source.length);
  // Opaque bodies also stay out of the parse, including inline <code> content.
  const edits = [...removed, ...huge, ...opaque].sort((left, right) => left.start - right.start);
  if (!edits.length) return { content: source, tags, originalOffset: (offset: number) => offset };
  const offsets = new Int32Array(source.length + 1);
  const chunks: string[] = [];
  let copied = 0;
  let written = 0;
  const copy = (end: number) => {
    if (end <= copied) return;
    chunks.push(source.slice(copied, end));
    for (; copied < end; copied++) offsets[written++] = copied;
  };
  for (const edit of edits) {
    copy(edit.start);
    copied = Math.max(copied, edit.end);
  }
  copy(source.length);
  offsets[written] = source.length;
  return { content: chunks.join(''), tags, originalOffset: (offset: number) => offsets[offset] ?? source.length };
};
