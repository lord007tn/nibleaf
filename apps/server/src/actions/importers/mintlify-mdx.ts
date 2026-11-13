import { closesMarkdownFence, type MarkdownFence, openingMarkdownFence, protectMarkdownCode } from '@nibleaf/shared/markdown-code';
import { replaceTags } from '@nibleaf/shared/markup-scan';
import { normalizeImportFidelity } from './import-fidelity';
import { importCodeLines } from './import-markdown-code';

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
  let fence: MarkdownFence | undefined;
  const protectedCode = protectMarkdownCode(content, { fences: false, maxFenceIndent: Number.POSITIVE_INFINITY });
  const codeLines = importCodeLines(protectedCode.content);

  const lines = protectedCode.content.split(/(\r\n|\r|\n)/);
  for (let lineIndex = 0; lineIndex * 2 < lines.length; lineIndex++) {
    const rawLine = lines[lineIndex * 2] ?? '';
    const trimmed = rawLine.trim();
    const closingName = trimmed.match(/^<\/([A-Z][A-Za-z0-9.]*)>\s*$/)?.[1];
    const currentIndent = componentIndents.at(-1)?.childIndent ?? 0;
    ending = codeLines[lineIndex] ? (lines[lineIndex * 2 + 1] ?? '') : '\n';
    if (codeLines[lineIndex] && currentIndent === 0) {
      push(rawLine);
      continue;
    }
    const removable = Math.min(leadingSpaces(rawLine), currentIndent);
    let line = rawLine.slice(removable);

    // Code examples are literal source. Only remove their surrounding real
    // component's indentation; example tags must never alter that component stack.
    if (fence) {
      push(line);
      if (closesMarkdownFence(line, fence)) fence = undefined;
      continue;
    }
    const opening = openingMarkdownFence(line);
    if (opening) {
      fence = opening;
      push(line.replace(/^(\s*```[A-Za-z0-9_+-]+)\s+.+$/, '$1'));
      continue;
    }

    if (closingName && unwrappedComponents.has(closingName)) {
      const matchingIndex = componentIndents.findLastIndex((entry) => entry.name === closingName);
      if (componentIndents[matchingIndex]?.keep) push(line);
      if (matchingIndex >= 0) componentIndents.splice(matchingIndex);
      continue;
    }

    const name = tagName(trimmed);
    const isComponentBoundary = name !== null && trimmed.startsWith(`<${name}`) && !trimmed.endsWith('/>') && !trimmed.includes(`</${name}>`);
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

  const output = normalized.map((line, index) => line + (index < normalized.length - 1 ? endings[index] : '')).join('');
  return normalizeImportFidelity(protectedCode.restore(output), onUnmapped);
};
