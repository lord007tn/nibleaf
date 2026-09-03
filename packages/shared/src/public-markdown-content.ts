const escapeHtml = (value: string): string =>
  value.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('"', '&quot;').replaceAll("'", '&#39;');

const mdxAttribute = (source: string, name: string): string | undefined => {
  const match = new RegExp(`(?:^|\\s)${name}\\s*=\\s*(?:"([^"]*)"|'([^']*)')`, 'i').exec(source);
  return match?.[1] ?? match?.[2];
};

const markdownText = (value?: string): string =>
  (value ?? '')
    .replace(/[\\`*_[\]<>]/g, '\\$&')
    .replace(/[\r\n]+/g, ' ')
    .trim();

const mdxContainer = (source: string, tag: string, render: (attributes: string, body: string) => string): string => {
  const pattern = new RegExp(`<${tag}\\b([^>]*)>([\\s\\S]*?)<\\/${tag}>`, 'gi');
  let current = source;
  for (let pass = 0; pass < 8; pass += 1) {
    const next = current.replace(pattern, (_match, attributes: string, body: string) => render(attributes, body.trim()));
    if (next === current) return current;
    current = next;
  }
  return current;
};

/** Convert supported authored MDX to inert Markdown for every public machine
 * representation. Only text and allowlisted attributes are projected. */
export const portablePublicMdxMarkdown = (source: string): string => {
  let output = source.replace(/<(?:File)\b([^>]*)\/>/gi, (_match, attributes: string) => {
    const name = markdownText(mdxAttribute(attributes, 'name'));
    return name ? `- \`${name}\`` : '';
  });
  output = output.replace(/<RelatedCard\b([^>]*)\/>/gi, (_match, attributes: string) => {
    const title = markdownText(mdxAttribute(attributes, 'title'));
    const description = markdownText(mdxAttribute(attributes, 'description'));
    const href = mdxAttribute(attributes, 'href')?.trim();
    return title ? `- ${href ? `[${title}](${href})` : title}${description ? ` — ${description}` : ''}` : '';
  });
  output = output.replace(/<Icon\b[^>]*\/>/gi, '');

  for (const tag of ['Callout', 'Note', 'Info', 'Tip', 'Check', 'Warning', 'Danger']) {
    output = mdxContainer(output, tag, (_attributes, body) =>
      body
        .split('\n')
        .map((line) => (line ? `> ${line}` : '>'))
        .join('\n'),
    );
  }
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
    const href = mdxAttribute(attributes, 'href')?.trim();
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
      const href = tag === 'Card' ? mdxAttribute(attributes, 'href')?.trim() : undefined;
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
  output = mdxContainer(output, 'Frame', (attributes, body) => {
    const caption = markdownText(mdxAttribute(attributes, 'caption'));
    return `${body}${caption ? `\n\n_${caption}_` : ''}`;
  });
  output = mdxContainer(output, 'Button', (attributes, body) => {
    const href = mdxAttribute(attributes, 'href')?.trim();
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
  const withoutActiveBlocks = stripActiveMarkup(portablePublicMdxMarkdown(source));
  return stripMdxExpressions(withoutActiveBlocks)
    .split('\n')
    .map((line) => (/^\s*(?:import|export)(?:\s|\{|\*)/.test(line) ? '' : escapeHtml(line)))
    .join('\n');
};

interface MarkdownFence {
  marker: '`' | '~';
  length: number;
}

const openingMarkdownFence = (line: string): MarkdownFence | undefined => {
  const match = /^ {0,3}(`{3,}|~{3,})/.exec(line);
  const token = match?.[1];
  if (!token) return undefined;
  return { marker: token.startsWith('`') ? '`' : '~', length: token.length };
};

const closesMarkdownFence = (line: string, fence: MarkdownFence): boolean => {
  const match = /^ {0,3}(\S+)\s*$/.exec(line);
  const token = match?.[1];
  return Boolean(token && token.length >= fence.length && [...token].every((character) => character === fence.marker));
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
