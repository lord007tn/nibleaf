import { markdownCodeSpans } from './markup-scan';
import { buildMdxTree, type MdxNode, tokenizeMdx } from './mdx-tokens';

/** A character reference a Markdown renderer decodes to text: named,
 *  decimal or hexadecimal. */
const CHARACTER_REFERENCE = /^&(?:[a-z][a-z\d]{1,31}|#\d{1,7}|#x[\da-f]{1,6});/i;

/** Make prose inert as HTML: `&`, `<` and `>` become references, leaving
 *  character references already written (`&amp;`, `&#65;`) as they are, since
 *  they decode to text and escaping them again would show their source
 *  (`&amp;amp;`). Quotes stay as written ("you're", not `you&#39;re`): prose
 *  never sits inside an attribute here, and without `<` no tag can open, so a
 *  quote can't change what the text means to an HTML or Markdown reader. */
const escapeHtml = (value: string): string =>
  value
    .replace(/&/g, (ampersand, offset: number) => (CHARACTER_REFERENCE.test(value.slice(offset, offset + 40)) ? ampersand : '&amp;'))
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;');

const mdxAttribute = (source: string, name: string): string | undefined => {
  const match = new RegExp(`(?:^|\\s)${name}\\s*=\\s*(?:"([^"]*)"|'([^']*)')`, 'i').exec(source);
  return match?.[1] ?? match?.[2];
};

/** Attribute text as inert Markdown text. Angle brackets become character references, not
 *  backslash escapes, so escaping the line for HTML afterwards doesn't show a literal `\&gt;`. */
const markdownText = (value: string): string =>
  value
    .replace(/[\\`*_[\]]/g, '\\$&')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;');

/** Decode what a Markdown renderer would decode in a link destination
 *  (character references, backslash escapes, ignored whitespace) before
 *  reading its scheme. */
const destinationForScheme = (href: string): string =>
  href
    .replace(/&#x([\da-f]{1,6});?/gi, (_match, hex: string) => String.fromCodePoint(Math.min(Number.parseInt(hex, 16), 0x10_ff_ff)))
    .replace(/&#(\d{1,7});?/g, (_match, decimal: string) => String.fromCodePoint(Math.min(Number(decimal), 0x10_ff_ff)))
    .replace(/&(colon|tab|newline);/gi, (_match, name: string) => ({ colon: ':', tab: '\t', newline: '\n' })[name.toLowerCase()] ?? '')
    .replace(/\\([!-/:-@[-`{-~])/g, '$1')
    // biome-ignore lint/suspicious/noControlCharactersInRegex: control characters are ignored inside URL schemes
    .replace(/[\u0000- \u007f]/g, '');

/** True for a link destination that is relative, `#`, http(s), mailto or tel.
 *  Angle brackets are refused: `<javascript:…>` would hide its scheme. */
export const isSafeLinkDestination = (href: string): boolean => {
  const decoded = destinationForScheme(href);
  if (/[<>]/.test(decoded)) return false;
  const scheme = /^([a-z][a-z\d+.-]*):/i.exec(decoded)?.[1]?.toLowerCase();
  return !scheme || ['http', 'https', 'mailto', 'tel'].includes(scheme);
};

/** A projected link destination: safe, with the characters that would end a
 *  Markdown destination (spaces, parentheses) percent-encoded, so it can't
 *  close its link and open another. */
const safeHref = (value?: string): string | undefined => {
  const href = value?.trim();
  if (!href || !isSafeLinkDestination(href)) return undefined;
  // UTF-8 bytes, as a browser would send them: U+2003 is `%E2%80%83`, not `%2003`.
  return href.replace(/[\s()]/g, (character) => (character === '(' ? '%28' : character === ')' ? '%29' : encodeURIComponent(character)));
};

/** Where a Markdown link destination starting at `start` ends: an `<…>`
 *  destination after its `>`, any other at whitespace or at a `)` that closes
 *  no parenthesis it opened. */
const destinationEnd = (source: string, start: number): number => {
  if (source[start] === '<') {
    const close = source.indexOf('>', start);
    const newline = source.indexOf('\n', start);
    return close >= 0 && (newline < 0 || close < newline) ? close + 1 : start;
  }
  let depth = 0;
  let index = start;
  for (; index < source.length; index += 1) {
    const character = source[index] as string;
    if (character === '\\') {
      index += 1;
      continue;
    }
    if (character.charCodeAt(0) <= 0x20) break;
    if (character === '(') depth += 1;
    if (character === ')') {
      if (depth === 0) break;
      depth -= 1;
    }
  }
  return index;
};

const unsafeDestination = (destination: string): boolean => {
  const bare = destination.startsWith('<') && destination.endsWith('>') ? destination.slice(1, -1) : destination;
  return bare.length > 0 && !isSafeLinkDestination(bare);
};

/** True when the character before `index` is escaped by an odd run of backslashes. */
const escapedAt = (source: string, index: number): boolean => {
  let backslashes = 0;
  for (let i = index - 1; i >= 0 && source[i] === '\\'; i -= 1) backslashes += 1;
  return backslashes % 2 === 1;
};

const skipSpaces = (source: string, index: number): number => {
  let at = index;
  while (source[at] === ' ' || source[at] === '\t') at += 1;
  return at;
};

/** Point authored links and images with an unsafe destination
 *  (`[x](javascript:…)`, `[x]: vbscript:…`) at `#`, as the HTML and PDF
 *  exports do; their text stays. This also covers a component body that
 *  carries its own link, such as a Button's. Code is masked before it runs. */
const neutralizeUnsafeLinks = (source: string): string => {
  let output = '';
  let cursor = 0;
  for (let at = source.indexOf('](', cursor); at >= 0; at = source.indexOf('](', cursor)) {
    // The destination may follow spaces and one line break.
    let start = skipSpaces(source, at + 2);
    if (source[start] === '\n') start = skipSpaces(source, start + 1);
    const end = destinationEnd(source, start);
    const unsafe = !escapedAt(source, at) && unsafeDestination(source.slice(start, end));
    output += unsafe ? `${source.slice(cursor, start)}#` : source.slice(cursor, end);
    cursor = Math.max(end, at + 2);
  }
  output += source.slice(cursor);
  return output.replace(/^( {0,3}\[(?:[^\]\\\n]|\\.)+\]:[ \t]*)(<[^>\n]*>|\S+)/gm, (definition, label: string, destination: string) =>
    unsafeDestination(destination) ? `${label}#` : definition,
  );
};

/** True when a boolean attribute is present: bare (`required`) or set (`required="true"`). */
const mdxFlag = (source: string, name: string): boolean => {
  const match = new RegExp(`(?:^|\\s)${name}(?=\\s|=|$)(?:\\s*=\\s*(?:"([^"]*)"|'([^']*)'|\\{([^}]*)\\}))?`, 'i').exec(source);
  if (!match) return false;
  const value = (match[1] ?? match[2] ?? match[3])?.trim();
  return value === undefined || !['false', '0'].includes(value);
};

/** One piece of projected output. `text` is authored prose and `attribute` is attribute text
 *  (both escaped for `.md`); `code` is kept byte for byte; `markup` is Markdown the projection writes. */
type Segment = { kind: 'text' | 'attribute' | 'code' | 'markup'; value: string };
type Target = 'markdown' | 'export';

const markup = (value: string): Segment => ({ kind: 'markup', value });

/** Attribute text as inert Markdown. Inline code in it stays code (`title="Use `<Note>`"`). */
const attributeText = (value: string | undefined): Segment[] => {
  const segments: Segment[] = [];
  const line = (value ?? '').replace(/[\r\n]+/g, ' ').trim();
  let cursor = 0;
  // markdownCodeSpans: what `/(`+)(?!`)([\s\S]*?[^`])\1(?!`)/g` finds, in linear time.
  for (const [start, end] of markdownCodeSpans(line)) {
    if (start > cursor) segments.push({ kind: 'attribute', value: markdownText(line.slice(cursor, start)) });
    segments.push({ kind: 'code', value: line.slice(start, end) });
    cursor = end;
  }
  if (cursor < line.length) segments.push({ kind: 'attribute', value: markdownText(line.slice(cursor)) });
  return segments;
};
const hasText = (segments: readonly Segment[]): boolean => segments.some((segment) => segment.value !== '');

/** Trim leading and trailing whitespace across segments, as a body is trimmed. */
const trimSegments = (segments: readonly Segment[]): Segment[] => {
  const result = segments.filter((segment) => segment.value !== '').map((segment) => ({ ...segment }));
  while (result[0] && !result[0].value.trimStart()) result.shift();
  while (result.at(-1) && !result.at(-1)?.value.trimEnd()) result.pop();
  // Code keeps its own indentation: trimming an indented fence's opening line would shift it.
  const first = result[0];
  if (first && first.kind !== 'code') first.value = first.value.trimStart();
  const last = result.at(-1);
  if (last && last.kind !== 'code') last.value = last.value.trimEnd();
  return result;
};

/** Prefix every line of `segments` (fence lines included), so nested containers prefix once per level. */
const prefixLines = (segments: readonly Segment[], prefix: (empty: boolean) => string): Segment[] => {
  const lines: Segment[][] = [[]];
  for (const segment of segments) {
    segment.value.split('\n').forEach((piece, index) => {
      if (index > 0) lines.push([]);
      if (piece) lines.at(-1)?.push({ ...segment, value: piece });
    });
  }
  return lines.flatMap((line, index) => [...(index > 0 ? [markup('\n')] : []), markup(prefix(line.length === 0)), ...line]);
};

const joined = (parts: ReadonlyArray<readonly Segment[]>, separator: string): Segment[] =>
  parts.filter(hasText).flatMap((part, index) => [...(index > 0 ? [markup(separator)] : []), ...part]);

const link = (label: Segment[], href: string | undefined): Segment[] => (href ? [markup('['), ...label, markup(`](${href})`)] : label);

const relatedLabel = (attributes: string): Segment[] => {
  const title = attributeText(mdxAttribute(attributes, 'title'));
  if (!hasText(title)) return [];
  const description = attributeText(mdxAttribute(attributes, 'description'));
  return [markup('- '), ...link(title, safeHref(mdxAttribute(attributes, 'href'))), ...(hasText(description) ? [markup(' — '), ...description] : [])];
};

type Renderer = (attributes: string, body: Segment[]) => Segment[];

const CALLOUTS = ['callout', 'note', 'info', 'tip', 'check', 'warning', 'danger'];
const quoted: Renderer = (_attributes, body) => prefixLines(body, (empty) => (empty ? '>' : '> '));
const indented = (body: Segment[]): Segment[] => prefixLines(body, (empty) => (empty ? '' : '  '));
const titled =
  (level: number, options: { href?: boolean; status?: boolean } = {}): Renderer =>
  (attributes, body) => {
    const title = attributeText(mdxAttribute(attributes, 'title'));
    const label = hasText(title) ? link(title, options.href ? safeHref(mdxAttribute(attributes, 'href')) : undefined) : [];
    const status = options.status ? attributeText(mdxAttribute(attributes, 'status')) : [];
    if (!hasText(label) && !hasText(status)) return body;
    return [markup(`${'#'.repeat(level)} `), ...label, ...(hasText(status) ? [markup(' · '), ...status] : []), markup('\n\n'), ...body];
  };
/** A parameter or response field: named by `name`, or by where it goes (`path`, `query`,
 *  `header`, `body`), then its type, `required`, `default` and `deprecated`. */
const field: Renderer = (attributes, body) => {
  const name = ['name', 'path', 'query', 'header', 'body'].map((key) => attributeText(mdxAttribute(attributes, key))).find(hasText) ?? [];
  const fallback = attributeText(mdxAttribute(attributes, 'default'));
  const details: Segment[][] = [
    attributeText(mdxAttribute(attributes, 'type')),
    mdxFlag(attributes, 'required') ? [markup('required')] : [],
    hasText(fallback) ? [markup('default: '), ...fallback] : [],
    mdxFlag(attributes, 'deprecated') ? [markup('deprecated')] : [],
  ];
  const heading = joined([name, ...details], ' · ');
  return hasText(heading) ? [markup('#### '), ...heading, markup('\n\n'), ...body] : body;
};
const unwrap: Renderer = (_attributes, body) => body;

/** How each supported component projects to inert Markdown, by lowercase tag name. Any other
 *  tag stays text. */
const RENDERERS: Readonly<Record<string, Renderer>> = {
  ...Object.fromEntries(CALLOUTS.map((name) => [name, quoted])),
  file: (attributes, body) => {
    const name = attributeText(mdxAttribute(attributes, 'name'));
    return joined([hasText(name) ? [markup('- `'), ...name, markup('`')] : [], body], '\n');
  },
  icon: () => [],
  folder: (attributes, body) => {
    const name = attributeText(mdxAttribute(attributes, 'name'));
    return [...(hasText(name) ? [markup('- **'), ...name, markup('/**')] : [markup('-')]), markup('\n'), ...indented(body)];
  },
  relatedcard: (attributes, body) => [...relatedLabel(attributes), ...(hasText(body) ? [markup('\n'), ...indented(body)] : [])],
  relatedcontent: titled(2),
  apiexample: titled(2),
  requestexample: titled(3),
  responseexample: titled(3, { status: true }),
  tab: titled(3),
  accordion: titled(3),
  expandable: titled(3),
  step: titled(3),
  card: titled(3, { href: true }),
  paramfield: field,
  responsefield: field,
  // A changelog entry: its label as a heading, then its description and body.
  update: (attributes, body) => {
    const label = attributeText(mdxAttribute(attributes, 'label'));
    return joined([hasText(label) ? [markup('## '), ...label] : [], attributeText(mdxAttribute(attributes, 'description')), body], '\n\n');
  },
  frame: (attributes, body) => {
    const caption = attributeText(mdxAttribute(attributes, 'caption'));
    return [...body, ...(hasText(caption) ? [markup('\n\n_'), ...caption, markup('_')] : [])];
  },
  button: (attributes, body) => link(body, safeHref(mdxAttribute(attributes, 'href'))),
  tooltip: (attributes, body) => {
    const tip = attributeText(mdxAttribute(attributes, 'tip'));
    return hasText(tip) ? [...body, markup(' ('), ...tip, markup(')')] : body;
  },
  badge: (_attributes, body) => [markup('**'), ...body, markup('**')],
  ...Object.fromEntries(
    ['filetree', 'tabs', 'accordiongroup', 'steps', 'cardgroup', 'codegroup', 'columns', 'column', 'banner'].map((name) => [name, unwrap]),
  ),
};
const COMPONENT_NAMES: ReadonlySet<string> = new Set(Object.keys(RENDERERS));

const renderNodes = (nodes: readonly MdxNode[], target: Target): Segment[] =>
  nodes.flatMap((node): Segment[] => {
    switch (node.kind) {
      case 'code':
        return [{ kind: 'code', value: node.value }];
      case 'text':
        return [{ kind: 'text', value: target === 'markdown' ? neutralizeUnsafeLinks(node.value) : node.value }];
      // `.md` escapes it with the prose; the exports write it as references, so `marked` never
      // sees an unpaired formatting tag.
      case 'stray':
        return target === 'markdown' ? [{ kind: 'text', value: node.value }] : [markup(node.value.replaceAll('<', '&lt;').replaceAll('>', '&gt;'))];
      // `.md` drops what would run or import; the exports show it as source, escaped by `marked`.
      case 'active':
      case 'expression':
      case 'esm':
        return target === 'markdown' ? [] : [{ kind: 'text', value: node.value }];
      default: {
        const children = renderNodes(node.children, target);
        const renderer = RENDERERS[node.name];
        if (renderer) return renderer(node.attributes, trimSegments(children));
        // A correctly nested formatting pair (`10<sup>-3</sup>`) is kept as markup.
        return [markup(`<${node.name}>`), ...children, markup(`</${node.name}>`)];
      }
    }
  });

const projectMdx = (source: string, target: Target): Segment[] => renderNodes(buildMdxTree(tokenizeMdx(source, COMPONENT_NAMES)), target);

/** Convert supported authored MDX to inert Markdown for the HTML and PDF exports, with the same
 *  tokenizer and projection as `.md`. Code is never rewritten; `marked` escapes raw HTML. */
export const portablePublicMdxMarkdown = (source: string): string =>
  projectMdx(source, 'export')
    .map((segment) => segment.value)
    .join('');

/** Authored MDX as public Markdown (`.md`, llms files): projected, with active markup, MDX
 *  expressions and ESM removed and prose escaped once. Code stays exactly as written. */
export const normalizePublicMarkdownContent = (markdown: string): string => {
  const parts: string[] = [];
  // Whether the current output line holds only spaces and quote markers so far, so prose that
  // follows starts the line. (Unambiguous patterns: nothing backtracks on long lines.)
  let atLineStart = true;
  const onlyMarkers = (value: string) => /^[ >]*$/.test(value);
  const append = (value: string) => {
    parts.push(value);
    const newline = value.lastIndexOf('\n');
    atLineStart = newline < 0 ? atLineStart && onlyMarkers(value) : onlyMarkers(value.slice(newline + 1));
  };
  for (const segment of projectMdx(markdown, 'markdown')) {
    if (segment.kind === 'code' || segment.kind === 'markup') {
      append(segment.value);
      continue;
    }
    // Prose is escaped once. An authored blockquote marker at the start of a line stays Markdown:
    // `>` there quotes text, it never opens a tag.
    const lineStart = atLineStart;
    append(
      segment.value
        .split('\n')
        .map((line, index) => {
          const marker = segment.kind === 'text' && (index > 0 || lineStart) ? (/^[ >]*>(?: (?! ))?/.exec(line)?.[0] ?? '') : '';
          return marker + escapeHtml(line.slice(marker.length));
        })
        .join('\n'),
    );
  }
  return parts.join('').trim();
};
