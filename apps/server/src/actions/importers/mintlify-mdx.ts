const tagName = (line: string): string | null => {
  const match = line.trim().match(/^<\/?([A-Z][A-Za-z0-9.]*)\b/);
  return match?.[1] ?? null;
};

const leadingSpaces = (line: string): number => line.match(/^ */)?.[0].length ?? 0;

const attribute = (tag: string, name: string): string | null => {
  const match = tag.match(new RegExp(`\\b${name}\\s*=\\s*(["'])(.*?)\\1`, 'i'));
  return match?.[2] ?? null;
};

const unwrappedComponents = new Set(['Steps', 'Step', 'CodeGroup', 'Expandable', 'AccordionGroup', 'Accordion', 'Frame', 'Tabs', 'Tab']);

const componentHeading = (name: string, tag: string): string => {
  const title = attribute(tag, 'title');
  if (!title) return '';
  return `${name === 'Expandable' ? '####' : '###'} ${title}`;
};

/**
 * Mintlify authors commonly indent Markdown inside JSX components. Standard
 * Markdown treats four leading spaces as a code block, which made component
 * children (including images) render as literal source in Nibleaf. Keep the
 * components intact, but remove only their structural indentation. Genuine
 * nested Markdown indentation beyond the component boundary is preserved.
 *
 * HTML/MDX images are converted to ordinary Markdown images after migration so
 * they use the same first-class image rendering path as Ghost and Markdown
 * imports.
 */
export const normalizeMintlifyMdx = (content: string): string => {
  const componentIndents: Array<{ name: string; childIndent: number }> = [];
  const normalized: string[] = [];
  let fence: { marker: string; length: number } | undefined;

  for (const rawLine of content.split(/\r?\n/)) {
    const trimmed = rawLine.trim();
    const closingName = trimmed.match(/^<\/([A-Z][A-Za-z0-9.]*)>\s*$/)?.[1];
    const currentIndent = componentIndents.at(-1)?.childIndent ?? 0;
    const removable = Math.min(leadingSpaces(rawLine), currentIndent);
    let line = rawLine.slice(removable);

    // Code examples are literal source. Only remove their surrounding real
    // component's indentation; example tags must never alter that component stack.
    if (fence) {
      normalized.push(line);
      const closing = /^ {0,3}(`+|~+)\s*$/.exec(line)?.[1];
      if (closing && closing[0] === fence.marker && closing.length >= fence.length) fence = undefined;
      continue;
    }
    const opening = /^ {0,3}(`{3,}|~{3,})(.*)$/.exec(line);
    const delimiter = opening?.[1];
    if (delimiter && !(delimiter[0] === '`' && opening?.[2]?.includes('`'))) {
      fence = { marker: delimiter[0] as string, length: delimiter.length };
      normalized.push(line.replace(/^(\s*```[A-Za-z0-9_+-]+)\s+.+$/, '$1'));
      continue;
    }

    if (closingName && unwrappedComponents.has(closingName)) {
      const matchingIndex = componentIndents.findLastIndex((entry) => entry.name === closingName);
      if (matchingIndex >= 0) componentIndents.splice(matchingIndex);
      continue;
    }

    const name = tagName(trimmed);
    const isComponentBoundary = name !== null && trimmed.startsWith(`<${name}`) && !trimmed.endsWith('/>') && !trimmed.includes(`</${name}>`);
    if (isComponentBoundary && unwrappedComponents.has(name)) {
      const heading = componentHeading(name, trimmed);
      if (heading) normalized.push(heading);
      componentIndents.push({ name, childIndent: leadingSpaces(rawLine) + 2 });
      continue;
    }

    line = line.replace(/<img\b[^>]*\/?>/gi, (imageTag) => {
      const src = attribute(imageTag, 'src');
      if (!src) return imageTag;
      const alt = attribute(imageTag, 'alt') ?? '';
      return `![${alt.replaceAll(']', '\\]')}](${src})`;
    });
    normalized.push(line);

    if (closingName) {
      const matchingIndex = componentIndents.findLastIndex((entry) => entry.name === closingName);
      if (matchingIndex >= 0) componentIndents.splice(matchingIndex);
      continue;
    }

    if (isComponentBoundary) {
      if (!name) continue;
      componentIndents.push({ name, childIndent: leadingSpaces(rawLine) + 2 });
    }
  }

  return normalized.join('\n');
};
