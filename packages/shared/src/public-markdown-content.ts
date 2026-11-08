import { closesMarkdownFence, type MarkdownFence, openingMarkdownFence, protectMarkdownCode } from './markdown-code';

/** A character reference a Markdown renderer decodes to text: named,
 *  decimal or hexadecimal. */
const CHARACTER_REFERENCE = /^&(?:[a-z][a-z\d]{1,31}|#\d{1,7}|#x[\da-f]{1,6});/i;

/** Escape HTML, leaving character references already written (`&amp;`,
 *  `&#65;`) as they are: they decode to text, never to markup, and escaping
 *  them again would show their source (`&amp;amp;`). */
const escapeHtml = (value: string): string =>
  value
    .replace(/&/g, (ampersand, offset: number) => (CHARACTER_REFERENCE.test(value.slice(offset, offset + 40)) ? ampersand : '&amp;'))
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');

/** A tag's attributes, up to the `>` that ends it: a `>` inside a quoted
 *  value doesn't end it. */
const ATTRIBUTES = `((?:[^>"']|"[^"]*"|'[^']*')*)`;

const mdxAttribute = (source: string, name: string): string | undefined => {
  const match = new RegExp(`(?:^|\\s)${name}\\s*=\\s*(?:"([^"]*)"|'([^']*)')`, 'i').exec(source);
  return match?.[1] ?? match?.[2];
};

/** An attribute value as one line of inert Markdown text. Angle brackets
 *  become character references, not backslash escapes, so escaping the line
 *  for HTML afterwards doesn't show a literal `\&gt;`. */
const markdownText = (value?: string): string =>
  (value ?? '')
    .replace(/[\\`*_[\]]/g, '\\$&')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replace(/[\r\n]+/g, ' ')
    .trim();

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

/** Project `<tag …>body</tag>`, for one tag or a family of tags, innermost
 *  first: a body never holds another opening tag of the family, so a nested
 *  container is projected before the one around it, and the outer one's line
 *  prefixes (`> `, indentation) apply once, to the finished inner text. */
const mdxContainer = (source: string, tags: string | readonly string[], render: (attributes: string, body: string) => string): string => {
  const family = (typeof tags === 'string' ? [tags] : tags).join('|');
  const pattern = new RegExp(`<(${family})\\b${ATTRIBUTES}>((?:(?!<(?:${family})\\b)[\\s\\S])*?)<\\/\\1>`, 'gi');
  let current = source;
  for (let pass = 0; pass < 8; pass += 1) {
    const next = current.replace(pattern, (_match, _tag: string, attributes: string, body: string) => render(attributes, body.trim()));
    if (next === current) return current;
    current = next;
  }
  return current;
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

/** Convert supported authored MDX to inert Markdown for every public machine
 * representation. Only text and allowlisted attributes are projected. */
export const portablePublicMdxMarkdown = (source: string): string => {
  let output = source.replace(new RegExp(`<File\\b${ATTRIBUTES}\\/>`, 'gi'), (_match, attributes: string) => {
    const name = markdownText(mdxAttribute(attributes, 'name'));
    return name ? `- \`${name}\`` : '';
  });
  output = output.replace(new RegExp(`<RelatedCard\\b${ATTRIBUTES}\\/>`, 'gi'), (_match, attributes: string) => {
    const title = markdownText(mdxAttribute(attributes, 'title'));
    const description = markdownText(mdxAttribute(attributes, 'description'));
    const href = safeHref(mdxAttribute(attributes, 'href'));
    return title ? `- ${href ? `[${title}](${href})` : title}${description ? ` — ${description}` : ''}` : '';
  });
  output = output.replace(new RegExp(`<Icon\\b${ATTRIBUTES}\\/>`, 'gi'), '');

  // One family, so a callout inside another is quoted once more, not twice.
  output = mdxContainer(output, ['Callout', 'Note', 'Info', 'Tip', 'Check', 'Warning', 'Danger'], (_attributes, body) =>
    body
      .split('\n')
      .map((line) => (line ? `> ${line}` : '>'))
      .join('\n'),
  );
  output = mdxContainer(output, 'Folder', (attributes, body) => {
    const name = markdownText(mdxAttribute(attributes, 'name'));
    const nested = body
      .split('\n')
      .map((line) => (line ? `  ${line}` : line))
      .join('\n');
    return `${name ? `- **${name}/**` : '-'}\n${nested}`;
  });
  output = mdxContainer(output, 'RelatedCard', (attributes, body) => {
    const title = markdownText(mdxAttribute(attributes, 'title'));
    const description = markdownText(mdxAttribute(attributes, 'description'));
    const href = safeHref(mdxAttribute(attributes, 'href'));
    return `${title ? `- ${href ? `[${title}](${href})` : title}${description ? ` — ${description}` : ''}` : ''}${body ? `\n  ${body}` : ''}`;
  });

  const titledContainers: ReadonlyArray<readonly [string, number]> = [
    ['RelatedContent', 2],
    ['ApiExample', 2],
    ['RequestExample', 3],
    ['ResponseExample', 3],
    ['Tab', 3],
    ['Accordion', 3],
    ['Expandable', 3],
    ['Step', 3],
    ['Card', 3],
  ];
  for (const [tag, level] of titledContainers) {
    output = mdxContainer(output, tag, (attributes, body) => {
      const title = markdownText(mdxAttribute(attributes, 'title'));
      const status = tag === 'ResponseExample' ? markdownText(mdxAttribute(attributes, 'status')) : '';
      const href = tag === 'Card' ? safeHref(mdxAttribute(attributes, 'href')) : undefined;
      const label = title ? (href ? `[${title}](${href})` : title) : '';
      return `${label || status ? `${'#'.repeat(level)} ${label}${status ? ` · ${status}` : ''}\n\n` : ''}${body}`;
    });
  }
  for (const tag of ['ParamField', 'ResponseField']) {
    output = mdxContainer(output, tag, (attributes, body) => {
      const name = markdownText(mdxAttribute(attributes, 'name'));
      const type = markdownText(mdxAttribute(attributes, 'type'));
      return `${name || type ? `#### ${name}${type ? ` · ${type}` : ''}\n\n` : ''}${body}`;
    });
  }
  // A changelog entry: its label as a heading, then its description and body.
  output = mdxContainer(output, 'Update', (attributes, body) => {
    const label = markdownText(mdxAttribute(attributes, 'label'));
    const description = markdownText(mdxAttribute(attributes, 'description'));
    return [label ? `## ${label}` : '', description, body].filter(Boolean).join('\n\n');
  });
  output = mdxContainer(output, 'Frame', (attributes, body) => {
    const caption = markdownText(mdxAttribute(attributes, 'caption'));
    return `${body}${caption ? `\n\n_${caption}_` : ''}`;
  });
  output = mdxContainer(output, 'Button', (attributes, body) => {
    const href = safeHref(mdxAttribute(attributes, 'href'));
    return href ? `[${body}](${href})` : body;
  });
  output = mdxContainer(output, 'Tooltip', (_attributes, body) => body);
  output = mdxContainer(output, 'Badge', (_attributes, body) => `**${body}**`);
  for (const tag of ['FileTree', 'Tabs', 'AccordionGroup', 'Steps', 'CardGroup', 'CodeGroup', 'Columns', 'Column', 'Banner']) {
    output = mdxContainer(output, tag, (_attributes, body) => body);
  }
  return output;
};

const activeBlockTag = /<\/?(?:script|style|iframe|object|embed)\b[^>]*>/gi;

const stripActiveMarkup = (source: string): string => {
  let output = '';
  let cursor = 0;
  let blockedDepth = 0;
  for (const match of source.matchAll(activeBlockTag)) {
    const token = match[0];
    const index = match.index;
    if (blockedDepth === 0) output += source.slice(cursor, index);
    if (token.startsWith('</')) {
      blockedDepth = Math.max(0, blockedDepth - 1);
      cursor = index + token.length;
    } else if (token.endsWith('/>')) {
      cursor = index + token.length;
    } else {
      blockedDepth += 1;
      if (blockedDepth === 1) cursor = index;
    }
  }
  if (blockedDepth === 0) output += source.slice(cursor);
  return output;
};

const stripMdxExpressions = (source: string): string => {
  let output = '';
  let expressionDepth = 0;
  for (const character of source) {
    if (character === '{') {
      expressionDepth += 1;
      continue;
    }
    if (character === '}') {
      expressionDepth = Math.max(0, expressionDepth - 1);
      continue;
    }
    if (expressionDepth === 0) output += character;
  }
  return output;
};

const sanitizeAuthoredProse = (source: string): string => {
  const protectedCode = protectMarkdownCode(source);
  const withoutActiveBlocks = stripActiveMarkup(neutralizeUnsafeLinks(portablePublicMdxMarkdown(protectedCode.content)));
  const sanitized = stripMdxExpressions(withoutActiveBlocks)
    .split('\n')
    .map((line) => (/^\s*(?:import|export)(?:\s|\{|\*)/.test(line) ? '' : escapeHtml(line)))
    .join('\n');
  return protectedCode.restore(sanitized);
};

export const normalizePublicMarkdownContent = (markdown: string): string => {
  const output: string[] = [];
  const prose: string[] = [];
  let fence: MarkdownFence | undefined;
  const flushProse = () => {
    if (prose.length === 0) return;
    output.push(sanitizeAuthoredProse(prose.join('\n')));
    prose.length = 0;
  };

  for (const line of markdown.split('\n')) {
    if (fence) {
      output.push(line);
      if (closesMarkdownFence(line, fence)) fence = undefined;
      continue;
    }
    const openingFence = openingMarkdownFence(line);
    if (openingFence) {
      flushProse();
      output.push(line);
      fence = openingFence;
      continue;
    }
    prose.push(line);
  }
  flushProse();
  return output.join('\n').trim();
};
