import { openingMarkdownFence } from '@nibleaf/shared/markdown-code';
import { replaceTags } from '@nibleaf/shared/markup-scan';
import { normalizeImportFidelity } from './import-fidelity';
import { protectImportCode, readImportComponentTag } from './import-markdown-code';

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
export const normalizeMintlifyMdx = (content: string, onUnmapped?: (url: string) => void): string => {
  const componentIndents: Array<{ name: string; childIndent: number; keep?: boolean }> = [];
  const normalized: string[] = [];
  const endings: string[] = [];
  let ending = '\n';
  const push = (line: string) => {
    normalized.push(line);
    endings.push(ending);
  };
  const protectedCode = protectImportCode(content);

  const lines = protectedCode.content.split(/(\r\n|\r|\n)/);
  let sourceOffset = 0;
  let componentTagEnd = 0;
  for (let lineIndex = 0; lineIndex * 2 < lines.length; lineIndex++) {
    const rawLine = lines[lineIndex * 2] ?? '';
    const lineOffset = sourceOffset;
    sourceOffset += rawLine.length + (lines[lineIndex * 2 + 1]?.length ?? 0);
    const trimmed = rawLine.trim();
    const inComponentTag = lineOffset < componentTagEnd;
    const closingName = inComponentTag ? undefined : trimmed.match(/^<\/([A-Z][A-Za-z0-9.]*)>\s*$/)?.[1];
    const currentIndent = componentIndents.at(-1)?.childIndent ?? 0;
    ending = '\n';
    const block = protectedCode.blocks.get(rawLine);
    if (block !== undefined) {
      const indent = Math.min(leadingSpaces(block), currentIndent);
      let normalizedBlock = indent > 0 ? block.replace(new RegExp(`(^|[\\r\\n]) {1,${indent}}`, 'g'), '$1') : block;
      if (currentIndent > 0 && openingMarkdownFence(normalizedBlock.split(/\r\n|\r|\n/, 1)[0] ?? '')) {
        normalizedBlock = normalizedBlock.replace(/^([ \t]*```[A-Za-z0-9_+-]+)[ \t]+[^\r\n]+/g, '$1');
      }
      protectedCode.blocks.set(rawLine, normalizedBlock);
      push(rawLine);
      continue;
    }
    const removable = Math.min(leadingSpaces(rawLine), currentIndent);
    let line = rawLine.slice(removable);

    if (closingName && unwrappedComponents.has(closingName)) {
      const matchingIndex = componentIndents.findLastIndex((entry) => entry.name === closingName);
      if (componentIndents[matchingIndex]?.keep) push(line);
      if (matchingIndex >= 0) componentIndents.splice(matchingIndex);
      continue;
    }

    const name = inComponentTag ? null : tagName(trimmed);
    const opener = name ? readImportComponentTag(protectedCode.content, lineOffset + rawLine.indexOf('<')) : undefined;
    if (opener) componentTagEnd = opener.end;
    const isComponentBoundary =
      name !== null && opener?.complete && !opener.selfClosing && trimmed.startsWith(`<${name}`) && !trimmed.includes(`</${name}>`);
    if (isComponentBoundary && unwrappedComponents.has(name)) {
      const keep = name === 'Frame' && Boolean(attribute(trimmed, 'caption'));
      const heading = componentHeading(name, trimmed);
      if (keep) push(line);
      else if (heading) push(heading);
      componentIndents.push({ name, childIndent: leadingSpaces(rawLine) + 2, keep });
      continue;
    }

    // replaceTags: the same as `line.replace`, in linear time when a `>` is missing.
    line = replaceTags(line, /<img\b[^>]*\/?>/gi, (imageTag) => {
      const src = attribute(imageTag, 'src');
      if (!src) return imageTag;
      const alt = attribute(imageTag, 'alt') ?? '';
      return `![${alt.replaceAll(']', '\\]')}](${src})`;
    });
    push(line);

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

  const last = normalized.at(-1) ?? '';
  const lastBlock = protectedCode.blocks.get(last);
  if (lastBlock !== undefined && !/[\r\n]$/.test(content)) {
    protectedCode.blocks.set(last, lastBlock.replace(/(?:\r\n|\r|\n)$/g, ''));
  }
  const output = normalized.map((line, index) => line + (index < normalized.length - 1 ? endings[index] : '')).join('');
  return normalizeImportFidelity(protectedCode.restore(output), onUnmapped);
};
