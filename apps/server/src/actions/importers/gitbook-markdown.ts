import { posix } from 'node:path';
import { closesMarkdownFence, type MarkdownFence, openingMarkdownFence, protectMarkdownCode } from '@nibleaf/shared/markdown-code';
import { parse as parseYaml } from 'yaml';
import { ImportError } from '../../errors';
import { GitBookImportBudget } from './gitbook-budget';
import { liquidPairs, liquidTokens, stripHeadingEnd } from './gitbook-tokens';
import { markdownReferences, replaceImportReferences } from './import-references';

/**
 * GitBook Git Sync Markdown → Nibleaf Markdown/MDX. GitBook stores its blocks
 * as Liquid-style tags (`{% hint %}`, `{% tabs %}`, `{% stepper %}`, …) plus a
 * handful of HTML conventions (`<figure>`, `<details>`, card tables, button
 * anchors). Each is mapped onto the renderer's existing components; anything
 * without an equivalent is unwrapped so its content survives, and reported.
 *
 * Kept pure (no prisma / fetch / `@/…` imports) so it is unit-testable.
 */

export interface GitBookPageMeta {
  description?: string;
  icon?: string;
  hidden?: boolean;
  mode?: 'wide';
  hideToc?: boolean;
}

const isDict = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null && !Array.isArray(value);

/** GitBook frontmatter is real YAML (folded descriptions, nested `layout`), so
 * the shared line-based reader is not enough here. */
export const parseGitBookFrontmatter = (raw: string): { meta: GitBookPageMeta; body: string } => {
  const match = raw.match(/^---\r?\n([\s\S]*?)\r?\n---[ \t]*(?:\r?\n|$)/);
  if (!match) return { meta: {}, body: raw };
  const body = raw.slice(match[0].length);
  let data: unknown;
  try {
    data = parseYaml(match[1] ?? '');
  } catch {
    return { meta: {}, body };
  }
  if (!isDict(data)) return { meta: {}, body };
  const meta: GitBookPageMeta = {};
  if (typeof data.description === 'string' && data.description.trim()) meta.description = data.description.trim().replace(/\s+/g, ' ');
  if (typeof data.icon === 'string' && data.icon.trim()) meta.icon = data.icon.trim();
  if (data.hidden === true) meta.hidden = true;
  const layout = isDict(data.layout) ? data.layout : {};
  if (layout.width === 'wide') meta.mode = 'wide';
  if (isDict(layout.tableOfContents) && layout.tableOfContents.visible === false) meta.hideToc = true;
  return { meta, body };
};

/** Lift a leading `# Title` out of the body: GitBook pages always open with
 * their title as an H1, which Nibleaf renders from the page title instead. */
export const extractGitBookTitle = (body: string): { title?: string; body: string } => {
  const prefix = /^\s*#[ \t]+/.exec(body);
  if (!prefix) return { body };
  const newline = body.indexOf('\n', prefix[0].length);
  const end = newline < 0 ? body.length : newline;
  const title = plainGitBookText(stripHeadingEnd(body.slice(prefix[0].length, end))).trim();
  if (!title) return { body };
  const rest = body.slice(newline < 0 ? end : end + 1);
  let blankEnd = 0;
  for (let index = 0; index < rest.length; index++) {
    if (rest[index] === '\n') blankEnd = index + 1;
    else if (rest[index] !== ' ' && rest[index] !== '\t' && rest[index] !== '\r') break;
  }
  return { title, body: rest.slice(blankEnd) };
};

const tagAttributes = (source: string): Record<string, string> => {
  const attributes: Record<string, string> = {};
  const word = /[A-Za-z][\w-]*/y;
  let cursor = 0;
  while (cursor < source.length) {
    if (!/[A-Za-z]/.test(source[cursor] ?? '')) {
      cursor++;
      continue;
    }
    word.lastIndex = cursor;
    const name = word.exec(source)?.[0];
    if (!name) {
      cursor++;
      continue;
    }
    cursor = word.lastIndex;
    while (/\s/.test(source[cursor] ?? '')) cursor++;
    if (source[cursor] !== '=') continue;
    cursor++;
    while (/\s/.test(source[cursor] ?? '')) cursor++;
    const quote = source[cursor];
    let value: string;
    if (quote === '"' || quote === "'") {
      const end = source.indexOf(quote, cursor + 1);
      if (end < 0) break;
      value = source.slice(cursor + 1, end);
      cursor = end + 1;
    } else {
      const start = cursor;
      while (cursor < source.length && !/[\s"']/.test(source[cursor] ?? '')) cursor++;
      value = source.slice(start, cursor);
    }
    attributes[name] = value.startsWith('<') && value.endsWith('>') ? value.slice(1, -1) : value;
  }
  return attributes;
};

const htmlAttribute = (tag: string, name: string): string | undefined => {
  const value = tagAttributes(tag)[name];
  return value === undefined ? undefined : decodeEntities(value);
};

const decodeEntities = (value: string): string =>
  value
    .replace(/&#x([0-9a-f]+);/gi, (_match, hex: string) => String.fromCodePoint(Math.min(0x10_ff_ff, Number.parseInt(hex, 16))))
    .replace(/&#(\d+);/g, (_match, decimal: string) => String.fromCodePoint(Math.min(0x10_ff_ff, Number(decimal))))
    .replace(/&quot;/g, '"')
    .replace(/&#39;|&apos;/g, "'")
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&amp;/g, '&');

/** decodeURIComponent that keeps malformed escapes (`100%`) as written. */
export const safeDecodeUri = (value: string): string => {
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
};

const HTML_TAGS = new Set(
  'a abbr b blockquote br button caption code col colgroup dd del details div dl dt em figcaption figure h1 h2 h3 h4 h5 h6 hr i iframe img input ins label li ol p picture pre s script small source span strong style sub summary sup table tbody td th thead tr u ul video'.split(
    ' ',
  ),
);

export const plainGitBookText = (value: string): string => {
  const decoded = decodeEntities(value);
  const closingNames = new Set([...decoded.matchAll(/<\/([A-Za-z][\w-]*)>/g)].map((match) => match[1]?.toLowerCase()));
  const text: string[] = [];
  for (let index = 0; index < decoded.length; index++) {
    if (decoded[index] === '<' && /[A-Za-z/!?]/.test(decoded[index + 1] ?? '')) {
      const end = decoded.indexOf('>', index + 1);
      if (end < 0) {
        text.push(decoded.slice(index));
        break;
      }
      const token = decoded.slice(index + 1, end);
      // Preserve bare generic type names when they have no paired closing tag.
      const name = /^\/?([A-Za-z][\w-]*)/.exec(token)?.[1]?.toLowerCase() ?? '';
      const suffix = token.slice(name.length + (token.startsWith('/') ? 1 : 0)).trim();
      const attributes =
        !suffix ||
        suffix === '/' ||
        suffix.includes('=') ||
        /^(?:data-[\w-]+|disabled|checked|hidden|open|selected|multiple|required)(?:\s+(?:data-[\w-]+|disabled|checked|hidden|open|selected|multiple|required))*$/.test(
          suffix,
        );
      const valid = (attributes && /^\/?[A-Za-z][\w-]*(?:\s[^<>]*|\/)?$/.test(token)) || /^[!?][^<>]*$/.test(token);
      if (!valid || (!HTML_TAGS.has(name) && !closingNames.has(name) && !token.startsWith('/') && !/^[!?]/.test(token))) {
        text.push(decoded.slice(index, end + 1));
      } else {
        index = end;
        continue;
      }
      index = end;
    } else text.push(decoded[index] ?? '');
  }
  return text.join('').replace(/\s+/g, ' ').trim();
};

/** Attribute values are emitted inside double quotes on JSX-like tags. */
const attr = (value: string): string => value.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;');

/** Markdown image destination; angle brackets keep spaces/parentheses (common
 * in `.gitbook/assets/image (1).png`) intact for the asset pass. */
const textChild = (value: string): string => value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/\{/g, '&#123;');

const imageMarkdown = (alt: string, src: string): string =>
  `![${alt.replace(/[[\]\n]/g, ' ').trim()}](${/[\s()<>]/.test(src) ? `<${src.replace(/>/g, '%3E')}>` : src})`;

const HINT_COMPONENT: Record<string, string> = { info: 'Info', success: 'Check', warning: 'Warning', danger: 'Danger', tip: 'Tip' };

/** Liquid tags GitBook defines whose output has a direct Nibleaf mapping. */
const KNOWN_TAGS = new Set([
  'hint',
  'tabs',
  'tab',
  'stepper',
  'step',
  'columns',
  'column',
  'updates',
  'update',
  'code',
  'embed',
  'file',
  'content-ref',
  'include',
  'prompt',
  'if',
  'swagger',
  'openapi',
  'openapi-operation',
  'openapi-schemas',
  'openapi-webhook',
]);

export interface GitBookConversionContext {
  /** Map a `{% file src %}` / card cover path to a browser-reachable URL. */
  resolveFile(reference: string): string | undefined;
}

export interface GitBookConversionResult {
  content: string;
  warnings: string[];
}

/** `{% code title="x" %}` annotates the fence that follows it. Fences must be
 * tracked so GitBook *examples* of its own syntax (inside code) stay literal. */
const applyCodeAnnotations = (content: string): string => {
  const output: string[] = [];
  let fence: MarkdownFence | undefined;
  let pendingTitle: string | undefined;
  for (const line of content.split('\n')) {
    if (fence) {
      output.push(line);
      if (closesMarkdownFence(line, fence, Number.POSITIVE_INFINITY)) fence = undefined;
      continue;
    }
    const tokens = liquidTokens(line);
    const token = tokens.length === 1 ? tokens[0] : undefined;
    const standalone = token && !line.slice(0, token.start).trim() && !line.slice(token.end).trim();
    if (standalone && token.name === 'code') {
      pendingTitle = tagAttributes(token.attributes).title;
      continue;
    }
    if (standalone && token.name === 'endcode') continue;
    const opening = openingMarkdownFence(line, Number.POSITIVE_INFINITY);
    if (opening) {
      fence = opening;
      if (pendingTitle && !/\btitle\s*=/.test(line)) {
        const [, indent = '', marker = '', info = ''] = line.match(/^(\s*)(`{3,}|~{3,})(.*)$/) ?? [];
        const language = info.trim().split(/\s+/)[0] ?? '';
        output.push(`${indent}${marker}${language || 'text'} title="${pendingTitle.replace(/"/g, "'")}"`);
      } else {
        output.push(line);
      }
      pendingTitle = undefined;
      continue;
    }
    output.push(line);
  }
  return output.join('\n');
};

const replaceHtmlBlocks = (
  source: string,
  opening: RegExp,
  closing: string,
  replace: (whole: string, inner: string, open: string) => string,
): string => {
  const lower = source.toLowerCase();
  const output: string[] = [];
  const openings = [...source.matchAll(opening)];
  let cursor = 0;
  let end = -1;
  for (let index = 0; index < openings.length; index++) {
    const match = openings[index];
    if (!match || match.index < cursor) continue;
    const start = match.index + match[0].length;
    if (end < start) end = lower.indexOf(closing, start);
    if (end < 0) break;
    if ((openings[index + 1]?.index ?? Number.POSITIVE_INFINITY) < end) continue;
    output.push(source.slice(cursor, match.index), replace(source.slice(match.index, end + closing.length), source.slice(start, end), match[0]));
    cursor = end + closing.length;
  }
  output.push(source.slice(cursor));
  return output.join('');
};

/** `<table data-view="cards">` is GitBook's card grid. Hidden columns carry the
 * link target (`data-card-target`) and cover (`data-card-cover`). */
const convertCardTable = (table: string, context: GitBookConversionContext): string => {
  const headers = [...table.matchAll(/<th\b([^<>]*)>/gi)].map((match) => match[1] ?? '');
  const targetIndex = headers.findIndex((header) => /\bdata-card-target\b/i.test(header));
  const coverIndex = headers.findIndex((header) => /\bdata-card-cover\b/i.test(header));
  const hidden = new Set(headers.flatMap((header, index) => (/\bdata-hidden\b/i.test(header) ? [index] : [])));
  let body = '';
  replaceHtmlBlocks(table, /<tbody\b[^<>]*>/gi, '</tbody>', (_whole, inner) => {
    body = inner;
    return '';
  });
  const cards: string[] = [];
  replaceHtmlBlocks(body, /<tr\b[^<>]*>/gi, '</tr>', (_whole, row) => {
    const cells: string[] = [];
    replaceHtmlBlocks(row, /<td\b[^<>]*>/gi, '</td>', (_cell, inner) => {
      cells.push(inner);
      return '';
    });
    const visible = cells.filter((_cell, index) => !hidden.has(index) && index !== targetIndex && index !== coverIndex).map(plainGitBookText);
    const [title = '', ...rest] = visible.filter(Boolean);
    const target = targetIndex >= 0 ? htmlAttribute(cells[targetIndex] ?? '', 'href') : undefined;
    const coverReference = coverIndex >= 0 ? htmlAttribute(cells[coverIndex] ?? '', 'href') : undefined;
    const cover = coverReference ? (context.resolveFile(coverReference) ?? coverReference) : undefined;
    const children = [cover ? imageMarkdown(title, cover) : '', rest.map(textChild).join('\n\n')].filter(Boolean).join('\n\n');
    cards.push(`<Card title="${attr(title || 'Untitled')}"${target ? ` href="${attr(target)}"` : ''}>\n\n${children}\n\n</Card>`);
    return '';
  });
  return cards.length > 0 ? `\n<CardGroup cols="${Math.min(3, cards.length)}">\n\n${cards.join('\n\n')}\n\n</CardGroup>\n` : '';
};

/** Block images are `<figure>` (optionally with `<picture>` light/dark sources
 * and a `<figcaption>`). The light `<img>` is kept; a caption becomes a Frame. */
const convertFigure = (figure: string): string => {
  const images = [...figure.matchAll(/<img\b[^<>]*>/gi)].flatMap((match) => {
    const src = htmlAttribute(match[0], 'src');
    return src ? [imageMarkdown(htmlAttribute(match[0], 'alt') ?? '', src)] : [];
  });
  if (images.length === 0) return figure;
  let caption = '';
  replaceHtmlBlocks(figure, /<figcaption\b[^<>]*>/gi, '</figcaption>', (_whole, inner) => {
    caption = plainGitBookText(inner);
    return '';
  });
  const markdown = images.join('\n\n');
  return caption ? `\n<Frame caption="${attr(caption)}">\n\n${markdown}\n\n</Frame>\n` : `\n${markdown}\n`;
};

const firstLinkLabel = (source: string): string => {
  const start = source.indexOf('[');
  const end = start < 0 ? -1 : source.indexOf(']', start + 1);
  return end < 0 ? '' : source.slice(start + 1, end);
};

/** First Markdown heading inside a step/update becomes its title attribute. */
const liftHeading = (body: string): { title?: string; body: string } => {
  const prefix = /^\s*#{1,6}[ \t]+/.exec(body);
  if (!prefix) return { body };
  const newline = body.indexOf('\n', prefix[0].length);
  const end = newline < 0 ? body.length : newline;
  return { title: plainGitBookText(stripHeadingEnd(body.slice(prefix[0].length, end))), body: body.slice(newline < 0 ? end : end + 1) };
};

/**
 * Convert one page body (frontmatter already removed, includes already
 * expanded). Code — fenced and inline — is protected from every rewrite.
 */
export const convertGitBookMarkdown = (source: string, context: GitBookConversionContext): GitBookConversionResult => {
  const warnings = new Set<string>();
  const protectedCode = protectMarkdownCode(applyCodeAnnotations(source.replace(/\r\n/g, '\n')), {
    maxFenceIndent: Number.POSITIVE_INFINITY,
  });
  const tokens = liquidTokens(protectedCode.content);
  const pairs = liquidPairs(tokens);
  const output: string[] = [];
  const hints: string[] = [];
  const block = (jsx: string) => `\n\n${jsx}\n\n`;
  const simple: Record<string, string> = {
    tabs: '<Tabs>',
    endtabs: '</Tabs>',
    endtab: '</Tab>',
    columns: '<Columns>',
    endcolumns: '</Columns>',
    column: '<Column>',
    endcolumn: '</Column>',
    stepper: '<Steps>',
    endstepper: '</Steps>',
  };
  const openapi = new Set(['swagger', 'openapi', 'openapi-operation', 'openapi-webhook', 'openapi-schemas']);
  let cursor = 0;
  for (let index = 0; index < tokens.length; index++) {
    const token = tokens[index];
    if (!token || token.start < cursor) continue;
    output.push(protectedCode.content.slice(cursor, token.start));
    cursor = token.end;
    const attributes = tagAttributes(token.attributes);
    const pairIndex = pairs.get(index);
    const closing = pairIndex !== undefined && pairIndex > index ? tokens[pairIndex] : undefined;
    const inner = closing ? protectedCode.content.slice(token.end, closing.start) : '';
    if (token.name === 'hint') {
      const component = HINT_COMPONENT[attributes.style?.toLowerCase() ?? 'info'] ?? 'Info';
      hints.push(component);
      output.push(block(`<${component}>`));
    } else if (token.name === 'endhint') {
      if (hints.length) output.push(block(`</${hints.pop()}>`));
    } else if (simple[token.name]) output.push(block(simple[token.name] ?? ''));
    else if (token.name === 'tab') output.push(block(`<Tab title="${attr(attributes.title ?? 'Tab')}">`));
    else if ((token.name === 'step' || token.name === 'update') && closing) {
      const heading = liftHeading(inner);
      const label = attributes.date ?? heading.title ?? 'Update';
      const component =
        token.name === 'step'
          ? `<Step${heading.title ? ` title="${attr(heading.title)}"` : ''}>`
          : `<Update label="${attr(label)}"${heading.title && heading.title !== label ? ` description="${attr(heading.title)}"` : ''}>`;
      output.push(block(component));
      cursor += inner.length - heading.body.length;
    } else if ((token.name === 'endstep' || token.name === 'endupdate') && pairIndex !== undefined) {
      output.push(block(token.name === 'endstep' ? '</Step>' : '</Update>'));
    } else if (token.name === 'content-ref' && closing) {
      const url = attributes.url ?? '';
      const label = plainGitBookText(firstLinkLabel(inner)) || posix.basename(url).replace(/\.md$/i, '') || url;
      output.push(`\n<Card title="${attr(label)}" href="${attr(url)}"></Card>\n`);
      cursor = closing.end;
      index = pairIndex ?? index;
    } else if (token.name === 'embed' || token.name === 'file') {
      // Optional captions contain prose only, ending at the immediately following closer.
      const caption = pairIndex === index + 1 ? inner.trim() : '';
      if (pairIndex === index + 1 && closing) {
        cursor = closing.end;
        index = pairIndex;
      }
      if (token.name === 'embed') {
        const url = attributes.url ?? '';
        if (url) {
          const host = URL.canParse(url) ? new URL(url).hostname.replace(/^www\./, '') : url;
          output.push(
            `\n<Card title="${attr(caption ? plainGitBookText(caption) : host)}" href="${attr(url)}" icon="arrow-up-right-from-square"></Card>\n`,
          );
        }
      } else {
        const src = attributes.src ?? '';
        if (src) {
          const href = context.resolveFile(src);
          if (!href) warnings.add(`File "${src}" could not be found in the repository; the link was kept as-is.`);
          const name = safeDecodeUri(posix.basename(src.split(/[?#]/)[0] ?? src));
          output.push(`\n<Card title="${attr(name)}" href="${attr(href ?? src)}" icon="file">\n\n${caption}\n\n</Card>\n`);
        }
      }
    } else if (openapi.has(token.name) && closing) {
      warnings.add('OpenAPI blocks were converted to links ? import the specification under API reference to render it.');
      if (token.name !== 'openapi-schemas') {
        const { src, spec, path = '', method = '' } = attributes;
        const title = `${method.toUpperCase()} ${path}`.trim() || 'API reference';
        output.push(
          `\n<Card title="${attr(title)}"${src ? ` href="${attr(src)}"` : ''} icon="code">\n\n${spec ? `OpenAPI specification: ${spec}` : ''}\n\n</Card>\n`,
        );
      }
      cursor = closing.end;
      index = pairIndex ?? index;
    } else if (['if', 'elsif', 'else'].includes(token.name)) {
      warnings.add('Adaptive-content conditions ({% if %}) were removed; all conditional content is now visible to every reader.');
    } else {
      const name = token.name.startsWith('end') ? token.name.slice(3) : token.name;
      if (!KNOWN_TAGS.has(name)) warnings.add(`Unsupported GitBook block "{% ${name} %}" was removed; its content was kept.`);
    }
  }
  output.push(protectedCode.content.slice(cursor));
  while (hints.length) output.push(block(`</${hints.pop()}>`));
  let content = output.join('');

  // HTML conventions.
  content = replaceHtmlBlocks(content, /<table\b[^<>]*>/gi, '</table>', (table, _inner, open) =>
    /\bdata-view\s*=\s*["']cards["']/i.test(open) ? convertCardTable(table, context) : table,
  );
  content = replaceHtmlBlocks(content, /<div\b[^<>]*>/gi, '</div>', (whole, inner) => (/^\s*<(?:figure|img)\b/i.test(inner) ? inner : whole));
  content = replaceHtmlBlocks(content, /<figure\b[^<>]*>/gi, '</figure>', convertFigure);
  content = replaceHtmlBlocks(content, /<picture\b[^<>]*>/gi, '</picture>', (picture) => {
    const image = picture.match(/<img\b[^<>]*>/i)?.[0];
    const src = image ? htmlAttribute(image, 'src') : undefined;
    return src && image ? imageMarkdown(htmlAttribute(image, 'alt') ?? '', src) : picture;
  });
  content = content.replace(/<img\b[^<>]*>/gi, (image) => {
    const src = htmlAttribute(image, 'src');
    return src ? imageMarkdown(htmlAttribute(image, 'alt') ?? '', src) : image;
  });
  content = replaceHtmlBlocks(content, /<details\b[^<>]*>/gi, '</details>', (whole, inner) => {
    let title: string | undefined;
    const body = replaceHtmlBlocks(inner, /<summary\b[^<>]*>/gi, '</summary>', (_whole, summary) => {
      title ??= plainGitBookText(summary) || 'Details';
      return '';
    });
    return title === undefined ? whole : `\n<Accordion title="${attr(title)}">\n\n${body.trim()}\n\n</Accordion>\n`;
  });
  content = content
    // Heading anchors GitBook appends: `## Title <a href="#title" id="title"></a>`.
    .replace(/^(#{1,6}[ \t][^\n]*?)<a\b[^<>]*\bid\s*=\s*["'][^"']*["'][^<>]*>[ \t]*<\/a>[ \t]*$/gm, (_match, heading: string) => heading.trimEnd())
    .replace(/^(#{1,6})[ \t]+<a\b[^<>]*\bid\s*=\s*["'][^"']*["'][^<>]*>[ \t]*<\/a>[ \t]*/gm, '$1 ');
  content = replaceHtmlBlocks(content, /<a\b[^<>]*>/gi, '</a>', (whole, label, open) => {
    const classes = htmlAttribute(open, 'class') ?? '';
    if (!/\bbutton\b/.test(classes)) return whole;
    const href = htmlAttribute(open, 'href') ?? '#';
    const variant = /\bsecondary\b/.test(classes) ? 'secondary' : 'primary';
    const child = textChild(plainGitBookText(label));
    return `<Button href="${attr(href)}" variant="${variant}">${child}</Button>`;
  });
  content = content
    // Inline icons: `<i class="fa-rocket">:rocket:</i>`.
    .replace(
      /<i\b[^<>]*\bclass\s*=\s*["'](?:fa[a-z]?\s+)?fa-([\w-]+)[^"']*["'][^<>]*>[^<]*<\/i>/gi,
      (_match, icon: string) => `<Icon icon="${attr(icon)}" />`,
    );

  content = content.replace(/\n{3,}/g, '\n\n');
  return { content: protectedCode.restore(content).trim(), warnings: [...warnings] };
};

const GITBOOK_SPACE_LINK = /https?:\/\/app\.gitbook\.com\/(?:o\/[^/\s"'()<>]+\/)?s\/[A-Za-z0-9]+[^\s"'()<>]*/g;

/** Links into a GitBook space (`app.gitbook.com/s/<id>/…`), outside code. The
 * space id alone does not say which published site or page they mean. */
export const findGitBookSpaceLinks = (content: string): string[] => {
  const prose = protectMarkdownCode(content, { maxFenceIndent: Number.POSITIVE_INFINITY }).content;
  return [...new Set(prose.match(GITBOOK_SPACE_LINK) ?? [])];
};

const MAX_INCLUDE_DEPTH = 5;
const REFERENCE_ATTRIBUTE = /(\b(?:src|href|url)\s*=\s*)(["'])([^"'\n]*)\2/gi;

/** Re-point a relative reference written in `fromDirectory` so it resolves the same from `toDirectory`. */
const rebaseReference = (reference: string, fromDirectory: string, toDirectory: string): string => {
  if (/^(?:[a-z][a-z0-9+.-]*:|[#/])/i.test(reference)) return reference;
  const index = reference.search(/[?#]/);
  const path = index === -1 ? reference : reference.slice(0, index);
  if (!path) return reference;
  const rebased = posix.relative(toDirectory, posix.join(fromDirectory, path)) || '.';
  return index === -1 ? rebased : `${rebased}${reference.slice(index)}`;
};

/** Markdown destinations and `src`/`href`/`url` attributes outside code, rebased between directories. */
const rebaseGitBookReferences = (content: string, fromDirectory: string, toDirectory: string): string => {
  if (fromDirectory === toDirectory) return content;
  const rebase = (reference: string) => rebaseReference(reference, fromDirectory, toDirectory);
  const protectedCode = protectMarkdownCode(content, { maxFenceIndent: Number.POSITIVE_INFINITY });
  const rewritten = replaceImportReferences(protectedCode.content, markdownReferences(protectedCode.content), (reference) => rebase(reference.value));
  return protectedCode.restore(
    rewritten.replace(
      REFERENCE_ATTRIBUTE,
      (_match, before: string, quote: string, reference: string) => `${before}${quote}${rebase(reference)}${quote}`,
    ),
  );
};

/**
 * Inline GitBook reusable content (`{% include ".gitbook/includes/x.md" %}`).
 * Paths resolve relative to the including file; nested includes are expanded up
 * to a fixed depth and cycles (including back to the page itself) are cut.
 * Relative links and images inside included content are rebased onto the
 * including file. `resolve` maps a reference to a repo path.
 */
export const expandGitBookIncludes = async (
  content: string,
  sourceFile: string,
  resolve: (reference: string, sourceFile: string) => string | undefined,
  load: (path: string) => Promise<string | null>,
  warnings: string[],
  stack: readonly string[] = [sourceFile],
  budget = new GitBookImportBudget(),
): Promise<string> => {
  const protectedCode = protectMarkdownCode(content, { maxFenceIndent: Number.POSITIVE_INFINITY });
  const matches = liquidTokens(protectedCode.content).filter((token) => token.name === 'include');
  if (matches.length === 0) return content;
  const replacements: string[] = [];
  for (const match of matches) {
    budget.include();
    const argument = match.attributes;
    const quote = argument[0];
    const end = quote === '"' || quote === "'" ? argument.indexOf(quote, 1) : argument.search(/\s/);
    const reference = argument.slice(quote === '"' || quote === "'" ? 1 : 0, end < 0 ? undefined : end);
    const path = resolve(reference, sourceFile);
    if (!path) {
      throw new ImportError({
        code: 'import:incomplete',
        message: 'GitBook source content is missing; the draft was preserved.',
        details: { path: reference.slice(0, 200), sourceFile },
      });
    }
    if (stack.includes(path)) {
      warnings.push(`Reusable content "${path}" includes itself or nests too deeply — the nested include was skipped.`);
      replacements.push('');
      continue;
    }
    if (stack.length > MAX_INCLUDE_DEPTH)
      throw new ImportError({ code: 'import:limit', message: 'GitBook import exceeded its include depth budget; the draft was preserved.' });
    const raw = await load(path);
    if (raw === null)
      throw new ImportError({
        code: 'import:incomplete',
        message: 'GitBook source content is missing; the draft was preserved.',
        details: { path: reference.slice(0, 200), sourceFile },
      });
    const { body } = parseGitBookFrontmatter(raw);
    const expanded = await expandGitBookIncludes(body.trim(), path, resolve, load, warnings, [...stack, path], budget);
    const rebased = rebaseGitBookReferences(expanded, posix.dirname(path), posix.dirname(sourceFile));
    budget.expansion(rebased);
    replacements.push(rebased);
  }
  const output: string[] = [];
  let cursor = 0;
  for (const [index, match] of matches.entries()) {
    output.push(protectedCode.content.slice(cursor, match.start), replacements[index] ?? '');
    cursor = match.end;
  }
  output.push(protectedCode.content.slice(cursor));
  const expanded = protectedCode.restore(output.join(''));
  budget.expansion(expanded);
  return expanded;
};
