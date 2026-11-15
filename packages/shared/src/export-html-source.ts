import { AttributeReplay } from './export-html-replay';
import { dangerous, isExportUrlAttribute, unsafeAttribute } from './export-url-policy';
import MarkdownIt from 'markdown-it';
import type Token from 'markdown-it/lib/token.mjs';
import { type DefaultTreeAdapterTypes, Parser, parseFragment } from 'parse5';

const ACTIVE_TAGS = ['script', 'style', 'iframe', 'object', 'embed'];
/** HTML element names are contiguous after `<`. This is only a sound prefilter;
 * Do not infer quote/code state here: containers can split a scheme and inline
 * code can contain misleading quotes. Only the rendered parse5 tree owns risk. */
export const mayHaveActiveExportHtml = (source: string): boolean => {
  if (!source.includes('<') && !source.includes('](') && !source.includes(']:')) return false;
  const lower = source.toLowerCase(),
    html = lower.includes('<');
  if (html && ACTIVE_TAGS.some((tag) => lower.includes(`<${tag}`))) return true;
  if (html && /(?:^|[^a-z0-9])on/.test(lower)) return true;
  if (/&(?!(?:amp|lt|gt|quot|apos);)/.test(lower)) return true;
  if (!lower.includes(':')) return false;
  const skeleton = lower.replace(/[^a-z:]/g, '');
  return ['javascript:', 'vbscript:', 'data:'].some((s) => skeleton.includes(s));
};
export interface ExportHtmlMetrics {
  generatedBytes: number;
  replayBytes: number;
  replayAnalyses: number;
  skip?: 'source' | 'tokens';
}
interface ReadOptions {
  hazards?: boolean;
  replay?: boolean;
  cached?: { tokens: Token[]; env: Record<string, unknown> };
  metrics?: ExportHtmlMetrics;
}
const markdown = new MarkdownIt({ html: true });
const inlineStarts = new WeakMap<Token, number>();
const inlineCode = new WeakMap<Token, string>();
const BaseInlineState = markdown.inline.State;
markdown.inline.State = class extends BaseInlineState {
  override push(type: string, tag: string, nesting: Token['nesting']): Token {
    const token = super.push(type, tag, nesting);
    if (type === 'html_inline' || type === 'code_inline' || type === 'image') inlineStarts.set(token, this.pos);
    if (type === 'code_inline') inlineCode.set(token, this.src);
    return token;
  }
};
interface HtmlSpan {
  token: Token;
  from: number;
  to: number;
  positions: number[];
}

export const parseExportTokens = (source: string) => markdown.parse(source, {});

export const readExportHtml = (source: string, options: ReadOptions = {}) => {
  const { hazards = false, replay: fullValues = false, cached, metrics } = options;
  const schemeRisk = new Map<string, boolean>();
  const attributeRisk = new Map<string, Map<string, Map<string, boolean>>>();
  const isDangerous = (value: string): boolean => {
    let result = schemeRisk.get(value);
    if (result === undefined) {
      result = dangerous(value);
      schemeRisk.set(value, result);
    }
    return result;
  };
  const isUnsafeAttribute = (attribute: DefaultTreeAdapterTypes.Element['attrs'][number], tag: string): boolean => {
    let names = attributeRisk.get(tag);
    if (!names) attributeRisk.set(tag, (names = new Map()));
    const name = attribute.prefix ? `${attribute.prefix}:${attribute.name}` : attribute.name;
    if (name.startsWith('on')) return true;
    if (!isExportUrlAttribute(name)) return false;
    let values = names.get(name);
    if (!values) names.set(name, (values = new Map()));
    let result = values.get(attribute.value);
    if (result === undefined) {
      result = unsafeAttribute(attribute, tag);
      values.set(attribute.value, result);
    }
    return result;
  };

  const lower = hazards ? '' : source.toLowerCase();
  const candidate = hazards ? mayHaveActiveExportHtml(source) : ACTIVE_TAGS.some((tag) => lower.includes(`<${tag}`));
  if (!candidate) {
    if (metrics) metrics.skip = 'source';
    return;
  }
  const input = source.replaceAll('\r\n', '\n').replaceAll('\r', '\n').replaceAll('\0', '\uFFFD');
  const env = cached?.env ?? {};
  const tokens = cached?.tokens ?? markdown.parse(input, env);
  if (hazards && !cached) {
    // With no raw HTML, generated HTML is well formed and all untrusted text
    // is escaped. Only accepted href/src token values can supply a target URL.
    const pending = [...tokens];
    let possible = false;
    while (pending.length) {
      const token = pending.pop();
      if (!token) continue;
      if (
        token.type === 'html_inline' ||
        token.type === 'html_block' ||
        ((token.type === 'link_open' || token.type === 'image') &&
          token.attrs?.some(([name, value]) => (name === 'href' || name === 'src') && isDangerous(value)))
      ) {
        possible = true;
        break;
      }
      if (token.children) for (const child of token.children) pending.push(child);
    }
    if (!possible) {
      if (metrics) metrics.skip = 'tokens';
      return;
    }
  }
  const offsets: number[] = [];
  if (input !== source) {
    for (let at = 0; at < source.length; at++) {
      offsets.push(at);
      if (source[at] === '\r' && source[at + 1] === '\n') at++;
    }
    offsets.push(source.length);
  }
  const originalOffset = (at: number) => (input === source ? Math.min(at, source.length) : (offsets[at] ?? source.length));
  const lines = input.split('\n');
  const lineStarts = [0];
  for (const line of lines) lineStarts.push((lineStarts.at(-1) ?? 0) + line.length + 1);
  const lineCursors = new Uint32Array(lines.length);
  let tableDepth = 0;
  const tableLines = new Map<number, { text: string; positions: number[] }>();
  const positionsFor = (content: string, map: [number, number]): number[] => {
    const positions: number[] = [];
    let lineAt = map[0];
    for (const line of content.split('\n')) {
      const raw = lines[lineAt] ?? '';
      let row = tableLines.get(lineAt);
      if (tableDepth && !row && raw.includes('\\|')) {
        const text: string[] = [];
        const positions: number[] = [];
        for (let at = 0; at < raw.length; at++) {
          if (raw[at] === '\\' && raw[at + 1] === '|') continue;
          text.push(raw[at] ?? '');
          positions.push((lineStarts[lineAt] ?? 0) + at);
        }
        positions.push((lineStarts[lineAt] ?? 0) + raw.length);
        row = { text: text.join(''), positions };
        tableLines.set(lineAt, row);
      }
      const original = tableDepth && row ? row.text : raw;
      const sourceAt = (at: number) => originalOffset(tableDepth && row ? (row.positions[at] ?? input.length) : (lineStarts[lineAt] ?? 0) + at);
      let leading = 0;
      while (line[leading] === ' ' || line[leading] === '\t') leading++;
      let cursor = original.indexOf(line, lineCursors[lineAt] ?? 0);
      if (cursor >= 0) {
        for (let at = 0; at < line.length; at++) positions.push(sourceAt(cursor + at));
        cursor += line.length;
      } else {
        cursor = lineCursors[lineAt] ?? 0;
        const tail = original.indexOf(line.slice(leading), cursor);
        let leadingAt = tail >= 0 ? tail : cursor;
        let columns = leading;
        while (leadingAt > cursor && columns > 0 && [' ', '\t'].includes(original[leadingAt - 1] ?? '')) {
          columns -= original[leadingAt - 1] === '\t' ? 4 : 1;
          leadingAt--;
        }
        if (tail >= 0) cursor = tail;
        for (let at = 0; at < line.length; at++) {
          if (at < leading) {
            positions.push(sourceAt(leadingAt));
            continue;
          }
          const found = original.indexOf(line[at] ?? '', cursor);
          if (found >= 0) cursor = found;
          positions.push(sourceAt(cursor));
          if (found >= 0) cursor++;
        }
      }
      lineCursors[lineAt] = cursor;
      positions.push(sourceAt(original.length));
      lineAt++;
    }
    positions.length = content.length;
    return positions;
  };

  const editable = new Uint8Array(source.length);
  const code = new Uint8Array(source.length);
  const leaders: number[] = [];
  const allow = (content: string, positions: number[]) => {
    for (const at of positions) editable[at] = 1;
    let line = 0;
    while (line < content.length) {
      let first = line;
      while (content[first] === ' ' || content[first] === '\t') {
        first++;
      }
      for (let at = line; at < first; at++) if (positions[at] !== undefined) leaders.push(positions[at] as number);
      if ('>+-#='.includes(content[first] ?? '') && content[first] && positions[first] !== undefined) leaders.push(positions[first] as number);
      let end = first;
      while (end < first + 9 && (content[end] ?? '') >= '0' && (content[end] ?? '') <= '9') end++;
      if (
        end > first &&
        (content[end] === '.' || content[end] === ')') &&
        [' ', '\t', '\n', ''].includes(content[end + 1] ?? '') &&
        positions[end] !== undefined
      )
        leaders.push(positions[end] as number);
      const newline = content.indexOf('\n', line);
      if (newline < 0) break;
      line = newline + 1;
    }
  };
  const destinationBounds = new Map<number, { sourceFrom: number; sourceTo: number }>();
  const chunks: string[] = [];
  const macros: Array<{ at: number; value: string }> = [];
  const escapedValues = new Map<string, string>();
  const spans: HtmlSpan[] = [];
  const renderedBounds: Array<{ from: number; to: number; end: number }> = [];
  let length = 0;
  let map: [number, number] = [0, lines.length];
  const protectInlineCode = (token: Token, positions: number[]) => {
    const start = inlineStarts.get(token) ?? 0;
    let end = start + token.markup.length;
    // Original characters corresponding to code are found from the inline
    // source captured by the parser, rather than normalized token.content.
    const location = inlineCode.get(token);
    if (location) {
      let at = start + token.markup.length;
      for (;;) {
        const next = location.indexOf('`', at);
        if (next < 0) {
          end = location.length;
          break;
        }
        at = next;
        while (location[at] === '`') at++;
        if (at - next === token.markup.length) {
          end = at;
          break;
        }
      }
    }
    for (let at = start; at < end; at++) {
      const original = positions[at];
      if (original !== undefined) code[original] = 1;
    }
  };
  const frames = [{ tokens, at: 0, positions: [] as number[] }];
  while (frames.length) {
    const frame = frames.at(-1);
    if (!frame) break;
    const token = frame.tokens[frame.at++];
    if (!token) {
      frames.pop();
      continue;
    }
    if (token.type === 'table_open') tableDepth++;
    if (token.type === 'table_close') tableDepth--;
    if (token.map) map = token.map;
    if (token.type === 'inline') {
      const positions = positionsFor(token.content, token.map ?? map);
      allow(token.content, positions);
      frames.push({ tokens: token.children ?? [], at: 0, positions });
      continue;
    }
    if ((token.type === 'fence' || token.type === 'code_block') && token.map)
      code.fill(1, originalOffset(lineStarts[token.map[0]] ?? input.length), originalOffset(lineStarts[token.map[1]] ?? input.length));
    if (token.type === 'code_inline') protectInlineCode(token, frame.positions);
    if (token.type === 'image' && token.children) {
      // Alt text has its own inline parser state, but its code spans still
      // carry author bytes. Walk those child states without rendering twice.
      const start = (inlineStarts.get(token) ?? 0) + 2;
      const pending = [{ tokens: token.children, positions: frame.positions.slice(start, start + token.content.length) }];
      while (pending.length) {
        const current = pending.pop();
        if (!current) continue;
        for (const child of current.tokens) {
          if (child.type === 'code_inline') protectInlineCode(child, current.positions);
          if (child.type === 'image' && child.children) {
            const start = (inlineStarts.get(child) ?? 0) + 2;
            pending.push({ tokens: child.children, positions: current.positions.slice(start, start + child.content.length) });
          }
        }
      }
    }
    const rule = markdown.renderer.rules[token.type];
    const attributes = token.attrs;
    // Abbreviate only the throwaway render's generated URLs/titles to bound
    // reference fanout. Authored destinations are never edited (#664).
    if (token.type === 'link_open' || token.type === 'image')
      token.attrs =
        attributes?.map(([name, value]) => [
          name,
          fullValues && ['href', 'src', 'title'].includes(name)
            ? ''
            : name === 'href' || name === 'src'
              ? hazards && isDangerous(value)
                ? 'data:'
                : '#'
              : name === 'title'
                ? ''
                : value,
        ]) ?? null;
    const value = rule
      ? rule(frame.tokens, frame.at - 1, markdown.options, env, markdown.renderer)
      : markdown.renderer.renderToken(frame.tokens, frame.at - 1, markdown.options);
    token.attrs = attributes;
    if (fullValues && (token.type === 'link_open' || token.type === 'image')) {
      for (const match of value.matchAll(/ (href|src|title)=""/g)) {
        const original = attributes?.find(([name]) => name === match[1])?.[1] ?? '';
        let escaped = escapedValues.get(original);
        if (escaped === undefined) {
          escaped = markdown.utils.escapeHtml(original);
          escapedValues.set(original, escaped);
        }
        macros.push({ at: length + match.index + match[0].length - 1, value: escaped });
      }
    }
    if (
      hazards &&
      (token.type === 'link_open' || token.type === 'image') &&
      attributes?.some(([name, value]) => (name === 'href' || name === 'src') && isDangerous(value))
    )
      destinationBounds.set(length, {
        sourceFrom: originalOffset(lineStarts[map[0]] ?? 0),
        sourceTo: originalOffset(lineStarts[map[1]] ?? input.length),
      });
    renderedBounds.push({ from: length, to: length + value.length, end: originalOffset(lineStarts[map[1]] ?? input.length) });
    if (token.type === 'html_block' || token.type === 'html_inline') {
      const positions =
        token.type === 'html_block'
          ? positionsFor(token.content, token.map ?? map)
          : frame.positions.slice(inlineStarts.get(token) ?? 0, (inlineStarts.get(token) ?? 0) + token.content.length);
      allow(token.content, positions);
      const span = { token, from: length, to: length + value.length, positions };
      spans.push(span);
    }
    chunks.push(value);
    length += value.length;
  }
  const html = chunks.join('');
  if (metrics) metrics.generatedBytes += html.length;
  const originalAt = new Int32Array(html.length).fill(-1);
  const endAt = new Int32Array(html.length);
  for (const bound of renderedBounds) endAt.fill(bound.end, bound.from, bound.to);
  for (const span of spans) for (let at = span.from; at < span.to; at++) originalAt[at] = span.positions[at - span.from] ?? -1;
  // A start tag spanning renderer-generated markup was unterminated in the
  // author's HTML token. Prefix counts keep every context lookup constant-time.
  const generatedBefore = new Uint32Array(html.length + 1);
  for (let at = 0; at < html.length; at++) generatedBefore[at + 1] = (generatedBefore[at] ?? 0) + Number((originalAt[at] ?? -1) < 0);
  const active: Array<[number, number]> = [];
  let risky = spans.some((span) => span.token.content.includes('<!') || span.token.content.includes('<?'));
  const hidden = new Int32Array(source.length + 1);
  const hide = (from: number, to: number) => {
    hidden[from] = (hidden[from] ?? 0) + 1;
    hidden[to] = (hidden[to] ?? 0) - 1;
  };
  const sourceEnd = (end: number): number => {
    if (end >= html.length) return source.length;
    if ((originalAt[end - 1] ?? -1) >= 0) return (originalAt[end - 1] ?? 0) + 1;
    return endAt[end - 1] ?? source.length;
  };
  const rawText = ['script', 'style', 'iframe', 'xmp', 'noembed', 'noframes', 'noscript', 'plaintext', 'textarea', 'title'];
  // Fragment parsing discards doctypes. Capture their token locations as well,
  // so a declaration opened in a changed run cannot release content past it.
  let unfinishedTag = false,
    lastRawEnd = 0;
  let mixedTag = false;
  const parser = Parser.getFragmentParser<DefaultTreeAdapterTypes.DefaultTreeAdapterMap>(null, {
    sourceCodeLocationInfo: true,
    onParseError: (error) => {
      if (error.code === 'eof-in-tag') unfinishedTag = true;
    },
  });
  const remember = (end: number | undefined) => {
    if (end != null && (originalAt[end - 1] ?? -1) >= 0) lastRawEnd = Math.max(lastRawEnd, sourceEnd(end));
  };
  const startTag = parser.onStartTag.bind(parser),
    endTag = parser.onEndTag.bind(parser),
    doctype = parser.onDoctype.bind(parser);
  parser.onStartTag = (token) => {
    const loc = token.location;
    if (loc && (originalAt[loc.startOffset] ?? -1) >= 0 && (generatedBefore[loc.endOffset] ?? 0) > (generatedBefore[loc.startOffset] ?? 0))
      mixedTag = true;
    remember(token.location?.endOffset);
    startTag(token);
  };
  parser.onEndTag = (token) => {
    const loc = token.location;
    if (loc && (originalAt[loc.startOffset] ?? -1) >= 0 && (generatedBefore[loc.endOffset] ?? 0) > (generatedBefore[loc.startOffset] ?? 0))
      mixedTag = true;
    remember(token.location?.endOffset);
    endTag(token);
  };
  parser.onDoctype = (token) => {
    const loc = token.location;
    if (loc && (originalAt[loc.startOffset] ?? -1) >= 0 && (generatedBefore[loc.endOffset] ?? 0) > (generatedBefore[loc.startOffset] ?? 0))
      mixedTag = true;
    const from = originalAt[token.location?.startOffset ?? -1] ?? -1;
    if (from >= 0 && token.location) {
      risky = true;
      hide(from, sourceEnd(token.location.endOffset));
    }
    remember(token.location?.endOffset);
    doctype(token);
  };
  if (fullValues) {
    const replay = new AttributeReplay();
    let at = 0;
    for (const macro of macros) {
      parser.tokenizer.write(html.slice(at, macro.at), false);
      replay.apply(parser.tokenizer, macro.value);
      at = macro.at;
    }
    parser.tokenizer.write(html.slice(at), true);
    if (metrics) {
      metrics.replayAnalyses += replay.analyses;
      metrics.replayBytes += replay.bytes;
    }
  } else parser.tokenizer.write(html, true);
  // Short attributes preserve the parse unless a raw start tag crossed generated
  // markup. In that case replay actual values with the SAME Markdown tokens.
  if (hazards && !fullValues && (mixedTag || unfinishedTag)) return readExportHtml(source, { ...options, replay: true, cached: { tokens, env } });
  if (unfinishedTag) {
    risky = true;
    hide(Math.max(0, lastRawEnd - 1), source.length);
  }
  const pending: DefaultTreeAdapterTypes.Node[] = [parser.getFragment()];
  while (pending.length) {
    const node = pending.pop();
    if (!node) continue;
    if ('tagName' in node && !node.sourceCodeLocation && hazards && node.attrs.some((a) => isUnsafeAttribute(a, node.tagName))) {
      risky = true;
      for (const span of spans) {
        const from = span.positions[0],
          to = span.positions.at(-1);
        if (from != null && to != null) active.push([from, to + 1]);
      }
    }
    if ('tagName' in node && node.sourceCodeLocation) {
      const loc = node.sourceCodeLocation;
      const from = originalAt[loc.startOffset] ?? -1;
      const unsafe = hazards && node.attrs.some((a) => isUnsafeAttribute(a, node.tagName));
      if (unsafe) {
        risky = true;
      }
      if (ACTIVE_TAGS.includes(node.tagName) || unsafe) {
        const end = loc.endTag?.endOffset ?? (node.tagName === 'embed' ? loc.startTag?.endOffset : loc.endOffset);
        const to = !loc.endTag && rawText.includes(node.tagName) ? source.length : sourceEnd(end ?? html.length);
        // A generated renderer token cannot create these elements. If its source
        // is unavailable, escape the raw HTML spans rather than throw on export.
        const destination = unsafe && destinationBounds.get(loc.startOffset);
        if (destination) active.push([destination.sourceFrom, destination.sourceTo]);
        else if (from >= 0) active.push([from, Math.max(from + 1, to)]);
        else
          for (const span of spans) {
            const first = span.positions[0],
              last = span.positions.at(-1);
            if (first != null && last != null) active.push([first, last + 1]);
          }
      }
      const opening = loc.startTag;
      const malformedOpening = opening && (generatedBefore[opening.endOffset] ?? 0) > (generatedBefore[opening.startOffset] ?? 0);
      if (from >= 0 && ((!loc.endTag && node.tagName !== 'embed') || malformedOpening)) risky = true;
      // Own the earlier malformed opener; a normal unclosed element does not
      // need to consume following code merely because its closing tag is absent.
      if (from >= 0 && malformedOpening) hide(from, Math.max(from + 1, sourceEnd(loc.endOffset)));
      if (from >= 0 && [...rawText, 'select', 'template', 'svg', 'math', 'table', 'frameset'].includes(node.tagName)) {
        risky = true;
        hide(from, loc.endTag ? sourceEnd(loc.endTag.endOffset) : source.length);
      }
    }
    const loc = 'sourceCodeLocation' in node ? node.sourceCodeLocation : undefined;
    if (loc && (node.nodeName === '#comment' || (node.nodeName === '#text' && html.slice(loc.startOffset, loc.endOffset).includes('<')))) {
      const from = originalAt[loc.startOffset] ?? -1;
      if (from >= 0) {
        risky = true;
        hide(from, Math.max(from, sourceEnd(loc.endOffset)));
      }
    }
    if ('childNodes' in node) for (const child of node.childNodes) pending.push(child);
  }
  if (!active.length) return;
  const inert: Array<[number, number]> = [];
  const ends = new Int32Array(source.length + 1);
  for (const [from, to] of active) ends[from] = Math.max(ends[from] ?? 0, to);
  const ordered: Array<[number, number]> = [];
  let depth = 0,
    start = -1;
  for (let at = 0; at <= source.length; at++) {
    if ((ends[at] ?? 0) > at) ordered.push([at, ends[at] ?? at]);
    depth += hidden[at] ?? 0;
    if (depth > 0 && start < 0) start = at;
    if (depth === 0 && start >= 0) {
      inert.push([start, at]);
      start = -1;
    }
  }
  return { tokens, active: ordered, inert, risky, spans, editable, code, leaders };
};

export const renderedExportText = (source: string): string => {
  const pending: DefaultTreeAdapterTypes.Node[] = [parseFragment(markdown.render(source))];
  const text: string[] = [];
  while (pending.length) {
    const node = pending.pop();
    if (!node) continue;
    if (node.nodeName === '#text' && 'value' in node) text.push(node.value);
    if ('childNodes' in node)
      for (let at = node.childNodes.length - 1; at >= 0; at--) {
        const child = node.childNodes[at];
        if (child) pending.push(child);
      }
  }
  return text.join('');
};

/** Decode only references the author wrote. Escape literal '<' first so the
 * decoder reads source as text, never as markup. Renderer-created spellings
 * are absent here: authored '-->' stays '-->', even if main rendered it as
 * the literal '--&gt;' inside a malformed raw-text context. */
export const authoredExportText = (source: string): string => {
  const literal = source.replaceAll('\r\n', '\n').replaceAll('\r', '\n').replaceAll('\0', '\uFFFD').replaceAll('<', '&lt;');
  return parseFragment(literal)
    .childNodes.map((node) => (node.nodeName === '#text' && 'value' in node ? node.value : ''))
    .join('');
};
export const exportTextEnd = (expected: string, actual: string, start = 0): number => {
  let cursor = start;
  for (const character of expected) {
    const at = actual.indexOf(character, cursor);
    if (at < 0) return -1;
    cursor = at + character.length;
  }
  return cursor;
};
export const exportTextInOrder = (expected: string, actual: string): boolean => exportTextEnd(expected, actual) >= 0;
