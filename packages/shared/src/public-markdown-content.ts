import { closesMarkdownFence, type MarkdownFence, openingMarkdownFence, protectMarkdownCode } from './markdown-code';

const escapeHtml = (value: string): string =>
  value.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('"', '&quot;').replaceAll("'", '&#39;');

const ATTRIBUTE_ENTITIES: Record<string, string> = { amp: '&', quot: '"', '#34': '"', apos: "'", '#39': "'", lt: '<', gt: '>' };

/** An authored attribute value, with the entities the editor writes (`&amp;`,
 *  `&quot;`) decoded once, so the output's own escaping isn't doubled. */
const mdxAttribute = (source: string, name: string): string | undefined => {
  const match = new RegExp(`(?:^|\\s)${name}\\s*=\\s*(?:"([^"]*)"|'([^']*)')`, 'i').exec(source);
  const value = match?.[1] ?? match?.[2];
  return value?.replace(/&(amp|quot|#34|apos|#39|lt|gt);/g, (entity, key: string) => ATTRIBUTE_ENTITIES[key] ?? entity);
};

/** One piece of a tag's attribute text: a character that isn't `>` or a quote,
 *  or a whole quoted value on one line, so `tip="a > b"` doesn't end the tag
 *  early. A quote that isn't closed on its line (an apostrophe inside
 *  `` title={`it's`} ``) is an ordinary character, so it can't run on. */
const ATTRIBUTE_PART = `(?:[^>"']|"[^"\\n]*"|'[^'\\n]*'|"(?![^"\\n]*")|'(?![^'\\n]*'))`;
const ATTRIBUTES = `(${ATTRIBUTE_PART}*)`;
/** The end of an opening tag: a `>` not after `/`, so `<Tag … />` isn't read as an opener. */
const OPENER_END = String.raw`(?<!\/)>`;
/** An atom, self-closing (`<File … />`) or written as an empty pair (`<File …></File>`). */
const atomPattern = (tag: string) => new RegExp(String.raw`<${tag}\b${ATTRIBUTES}(?:\/>|>\s*<\/${tag}>)`, 'gi');

/** Attribute text projected into Markdown, with Markdown syntax escaped.
 *  `<` and `>` are escaped too, so text can't form an autolink or a tag,
 *  unless the output escapes HTML itself afterwards (`.md`), where a
 *  backslash would show. */
const markdownText = (value: string | undefined, escapeAngles: boolean): string =>
  (value ?? '')
    .replace(escapeAngles ? /[\\`*_[\]{}<>]/g : /[\\`*_[\]{}]/g, '\\$&')
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

/** A projected link destination, safe and with the characters that would end
 *  a Markdown destination (spaces, parentheses) percent-encoded. */
const safeHref = (value?: string): string | undefined => {
  const href = value?.trim();
  if (!href || !isSafeLinkDestination(href)) return undefined;
  return href.replace(/[\s()]/g, (character) => `%${character.charCodeAt(0).toString(16).toUpperCase().padStart(2, '0')}`);
};

const mdxContainer = (source: string, tag: string, render: (attributes: string, body: string) => string): string => {
  const pattern = new RegExp(String.raw`<${tag}\b${ATTRIBUTES}${OPENER_END}([\s\S]*?)<\/${tag}>`, 'gi');
  let current = source;
  for (let pass = 0; pass < 8; pass += 1) {
    const next = current.replace(pattern, (_match, attributes: string, body: string) => render(attributes, body.trim()));
    if (next === current) return current;
    current = next;
  }
  return current;
};

/** How projected attribute text enters the output: as is, or held aside so
 *  later passes over authored markup can't read it as markup. */
type Projector = { text: (value?: string) => string; link: (value?: string) => string | undefined };
const projector = (keep: (value: string) => string, escapeAngles: boolean): Projector => ({
  text: (value) => {
    const text = markdownText(value, escapeAngles);
    return text ? keep(text) : '';
  },
  link: (value) => {
    const href = safeHref(value);
    return href ? keep(href) : undefined;
  },
});
const asIs = projector((value) => value, true);

/** A RelatedCard as a list item: its linked title and its description. */
const relatedCardItem = (attributes: string, { text, link }: Projector): string => {
  const title = text(mdxAttribute(attributes, 'title'));
  const description = text(mdxAttribute(attributes, 'description'));
  const href = link(mdxAttribute(attributes, 'href'));
  return title ? `- ${href ? `[${title}](${href})` : title}${description ? ` — ${description}` : ''}` : '';
};

/** An attribute that is present bare (`required`), or set to "true" or `{true}`. */
const flagAttribute = (attributes: string, name: string): boolean => {
  for (const match of attributes.matchAll(/([\w:-]+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|\{([^}]*)\}|([^\s"'=<>`]+)))?/g)) {
    if (match[1]?.toLowerCase() !== name.toLowerCase()) continue;
    const value = match[2] ?? match[3] ?? match[4] ?? match[5];
    return value === undefined || ['', 'true'].includes(value.trim());
  }
  return false;
};

/** Convert supported authored MDX to inert Markdown for every public machine
 * representation. Only text and allowlisted attributes are projected. Code
 * stays literal, so a component written as an example isn't rewritten. */
export const portablePublicMdxMarkdown = (source: string): string => {
  const code = protectMarkdownCode(source);
  return code.restore(projectComponents(code.content, asIs, code.reshape));
};

/** Re-shapes hidden code: see `protectMarkdownCode().reshape`. */
type ReshapeCode = (value: string, change: (literal: string) => string) => string;

/** Prefix every line of a container body, code it wraps included: the first
 *  line of a hidden code block sits on a body line, the rest are inside it.
 *  Blank lines get `blank`. */
const prefixLines = (body: string, prefix: string, blank: string, reshape: ReshapeCode): string => {
  const prefixRest = (value: string) =>
    value
      .split('\n')
      .map((line, index) => (index === 0 ? line : line ? `${prefix}${line}` : blank))
      .join('\n');
  return reshape(body, prefixRest)
    .split('\n')
    .map((line) => (line ? `${prefix}${line}` : blank))
    .join('\n');
};

const projectComponents = (source: string, project: Projector, reshape: ReshapeCode): string => {
  const { text, link } = project;
  let output = source.replace(atomPattern('File'), (_match, attributes: string) => {
    const name = text(mdxAttribute(attributes, 'name'));
    return name ? `- \`${name}\`` : '';
  });
  // Self-closing cards first, so a pair after one can't be read as its body.
  output = output.replace(new RegExp(String.raw`<RelatedCard\b${ATTRIBUTES}\/>`, 'gi'), (_match, attributes: string) =>
    relatedCardItem(attributes, project),
  );
  output = output.replace(atomPattern('Icon'), '');

  for (const tag of ['Callout', 'Note', 'Info', 'Tip', 'Check', 'Warning', 'Danger']) {
    output = mdxContainer(output, tag, (_attributes, body) => prefixLines(body, '> ', '>', reshape));
  }
  output = mdxContainer(output, 'Folder', (attributes, body) => {
    const name = text(mdxAttribute(attributes, 'name'));
    return `${name ? `- **${name}/**` : '-'}\n${prefixLines(body, '  ', '', reshape)}`;
  });
  output = mdxContainer(output, 'RelatedCard', (attributes, body) =>
    [relatedCardItem(attributes, project), body ? prefixLines(body, '  ', '', reshape) : ''].filter(Boolean).join('\n'),
  );

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
      const title = text(mdxAttribute(attributes, 'title'));
      const status = tag === 'ResponseExample' ? text(mdxAttribute(attributes, 'status')) : '';
      const href = tag === 'Card' ? link(mdxAttribute(attributes, 'href')) : undefined;
      const label = title ? (href ? `[${title}](${href})` : title) : '';
      return `${label || status ? `${'#'.repeat(level)} ${label}${status ? ` · ${status}` : ''}\n\n` : ''}${body}`;
    });
  }
  for (const tag of ['ParamField', 'ResponseField']) {
    output = mdxContainer(output, tag, (attributes, body) => {
      // Like the reader, a location prop names a ParamField before `name` does.
      const authoredName = ['path', 'query', 'header', 'body', 'name']
        .map((key) => mdxAttribute(attributes, key))
        .find((value) => value !== undefined);
      const name = text(authoredName);
      const defaultValue = text(mdxAttribute(attributes, 'default'));
      const details = [
        text(mdxAttribute(attributes, 'type')),
        flagAttribute(attributes, 'required') ? 'required' : '',
        defaultValue ? `default: ${defaultValue}` : '',
        flagAttribute(attributes, 'deprecated') ? 'deprecated' : '',
      ].filter(Boolean);
      return `${name || details.length > 0 ? `#### ${[name, ...details].filter(Boolean).join(' · ')}\n\n` : ''}${body}`;
    });
  }
  output = mdxContainer(output, 'Frame', (attributes, body) => {
    const caption = text(mdxAttribute(attributes, 'caption'));
    return `${body}${caption ? `\n\n_${caption}_` : ''}`;
  });
  output = mdxContainer(output, 'Button', (attributes, body) => {
    const href = link(mdxAttribute(attributes, 'href'));
    return href ? `[${body}](${href})` : body;
  });
  // Keep the tip as readable text: `API (Application programming interface)`.
  output = mdxContainer(output, 'Tooltip', (attributes, body) => {
    const tip = text(mdxAttribute(attributes, 'tip'));
    return tip ? `${body} (${tip})` : body;
  });
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
  const characters = [...source];
  for (let index = 0; index < characters.length; index += 1) {
    const character = characters[index] as string;
    const next = characters[index + 1];
    // `\{`, `\}` and `\\` are literal text in MDX. Projected attribute text
    // (a tooltip's tip, a field name) is escaped this way, so it keeps its braces.
    if (character === '\\' && expressionDepth === 0 && (next === '{' || next === '}' || next === '\\')) {
      output += character + next;
      index += 1;
      continue;
    }
    if (character === '{') {
      expressionDepth += 1;
      continue;
    }
    if (character === '}') {
      // A `}` that closes nothing is text, not the end of an expression.
      if (expressionDepth === 0) output += character;
      expressionDepth = Math.max(0, expressionDepth - 1);
      continue;
    }
    if (expressionDepth === 0) output += character;
  }
  return output;
};

/** Escape a prose line, keeping its blockquote markers (`> `) as Markdown. */
const escapeProseLine = (line: string): string => {
  const marker = /^(?: {0,3}>[ \t]?)+/.exec(line)?.[0] ?? '';
  return marker + escapeHtml(line.slice(marker.length));
};

// Formatting the editor saves as inline HTML (Underline, Subscript, Superscript).
// Public Markdown escapes HTML. Underline is presentation only, so it keeps
// just its text. Subscript and superscript carry meaning (10<sup>-3</sup>,
// x<sub>i<sup>2</sup></sub>), so correctly nested pairs within a paragraph stay
// as attribute-free inline HTML, which Markdown allows. They are restored only
// after escaping, so nothing else can pass through; an unmatched tag keeps
// just its text.
const underlineTag = new RegExp(`<\\/?u(?:\\s${ATTRIBUTE_PART}*)?>`, 'gi');
const scriptOpenerWithAttributes = new RegExp(`<(sub|sup)\\s${ATTRIBUTE_PART}*>`, 'gi');
const escapedScriptTag = /&lt;(\/?)(sub|sup)&gt;/gi;
// Lines with text, joined: inline HTML can't span a blank line.
const PARAGRAPH = /[^\n]*\S[^\n]*(?:\n[^\n]*\S[^\n]*)*/g;

const restoreScriptPairs = (paragraph: string): string => {
  const matched = new Set<number>();
  const open: { name: string; index: number }[] = [];
  [...paragraph.matchAll(escapedScriptTag)].forEach((match, index) => {
    const name = (match[2] as string).toLowerCase();
    if (!match[1]) {
      open.push({ name, index });
    } else if (open.at(-1)?.name === name) {
      matched.add((open.pop() as { index: number }).index);
      matched.add(index);
    }
  });
  let index = 0;
  return paragraph.replace(escapedScriptTag, (_match, slash: string, tag: string) => (matched.has(index++) ? `<${slash}${tag.toLowerCase()}>` : ''));
};

/** Hold values aside behind private placeholders, then put them back. */
const literalStore = (source: string) => {
  let prefix = `\uE002${crypto.randomUUID()}:`;
  while (source.includes(prefix)) prefix = `\uE002${crypto.randomUUID()}:`;
  const values: string[] = [];
  const placeholder = new RegExp(`${prefix}(\\d+)\uE003`, 'g');
  return {
    keep: (value: string) => `${prefix}${values.push(value) - 1}\uE003`,
    restore: (output: string, transform: (value: string) => string) =>
      output.replace(placeholder, (_match, index: string) => transform(values[Number(index)] ?? '')),
  };
};

/** Sanitize one stretch of prose between code fences: drop active markup and
 *  MDX expressions, and escape what's left as text. */
const sanitizeProse = (source: string): string => {
  const protectedCode = protectMarkdownCode(source);
  const withoutActiveBlocks = stripActiveMarkup(protectedCode.content).replace(underlineTag, '').replace(scriptOpenerWithAttributes, '<$1>');
  const sanitized = stripMdxExpressions(withoutActiveBlocks)
    .split('\n')
    .map((line) => (/^\s*(?:import|export)(?:\s|\{|\*)/.test(line) ? '' : escapeProseLine(line)))
    .join('\n')
    .replace(PARAGRAPH, (paragraph) => restoreScriptPairs(paragraph));
  return protectedCode.restore(sanitized);
};

/** Public Markdown for a page (`.md`, llms).
 *  1. Components are projected over the whole page, with its code held aside,
 *     so a component around a code block (a CodeGroup, a Card with an example)
 *     is projected like any other.
 *  2. Prose between code fences is then sanitized one stretch at a time, so an
 *     unclosed `<style>` can't hide the rest of the page.
 *  Projected attribute text (a tip, a title) is plain text: it is held aside
 *  through both steps, so `tip="The <style> element"` can't be read as markup,
 *  and put back HTML-escaped at the end. */
export const normalizePublicMarkdownContent = (markdown: string): string => {
  const code = protectMarkdownCode(markdown);
  const projected = literalStore(markdown);
  const keep = (value: string) => projected.keep(code.restore(value));
  const projectedMarkdown = code.restore(projectComponents(code.content, projector(keep, false), code.reshape));
  const output: string[] = [];
  const prose: string[] = [];
  let fence: MarkdownFence | undefined;
  const flushProse = () => {
    if (prose.length === 0) return;
    output.push(sanitizeProse(prose.join('\n')));
    prose.length = 0;
  };
  for (const line of projectedMarkdown.split('\n')) {
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
  return projected.restore(output.join('\n'), escapeHtml).trim();
};
