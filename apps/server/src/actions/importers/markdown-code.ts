import { randomUUID } from 'node:crypto';

export interface MarkdownFence {
  marker: string;
  length: number;
}

export const openingMarkdownFence = (line: string, maxIndent = 3): MarkdownFence | undefined => {
  const match = /^( *)(`{3,}|~{3,})(.*)$/.exec(line);
  const delimiter = match?.[2];
  if (!delimiter || (match?.[1]?.length ?? 0) > maxIndent || (delimiter[0] === '`' && match?.[3]?.includes('`'))) return undefined;
  return { marker: delimiter.charAt(0), length: delimiter.length };
};

export const closesMarkdownFence = (line: string, fence: MarkdownFence, maxIndent = 3): boolean => {
  const match = /^( *)(`+|~+)\s*$/.exec(line);
  return Boolean(match && (match[1]?.length ?? 0) <= maxIndent && match[2]?.[0] === fence.marker && match[2].length >= fence.length);
};

/** Hide literal code from regex-based import passes, then restore exact bytes.
 * Mintlify passes may opt into structural JSX indentation before normalization.
 * The normalizer itself keeps fences visible so it can remove only that indent. */
export const protectMarkdownCode = (source: string, { fences = true, maxFenceIndent = 3 } = {}) => {
  let prefix = `\uE000${randomUUID()}:`;
  while (source.includes(prefix)) prefix = `\uE000${randomUUID()}:`;
  const literals: string[] = [];
  const hide = (value: string) => `${prefix}${literals.push(value) - 1}\uE001`;
  const protectInline = (prose: string): string => {
    const runs = [...prose.matchAll(/`+/g)];
    const nextByLength = new Map<number, number>();
    const closingIndexes: number[] = [];
    for (let index = runs.length - 1; index >= 0; index--) {
      const run = runs[index];
      if (!run) continue;
      closingIndexes[index] = nextByLength.get(run[0].length) ?? -1;
      nextByLength.set(run[0].length, index);
    }
    let output = '';
    let cursor = 0;
    for (let index = 0; index < runs.length; index++) {
      const opening = runs[index];
      if (!opening) continue;
      let escapes = 0;
      for (let before = opening.index - 1; before >= 0 && prose[before] === '\\'; before--) escapes++;
      if (escapes % 2) continue;
      const closingIndex = closingIndexes[index] ?? -1;
      if (closingIndex < 0) continue;
      const closing = runs[closingIndex];
      if (!closing) continue;
      output += prose.slice(cursor, opening.index) + hide(prose.slice(opening.index, closing.index + closing[0].length));
      cursor = closing.index + closing[0].length;
      index = closingIndex;
    }
    return output + prose.slice(cursor);
  };

  let content = '';
  let prose = '';
  let code = '';
  let fence: MarkdownFence | undefined;
  for (const raw of source.match(/[^\n]*\n|[^\n]+$/g) ?? []) {
    const line = raw.replace(/\r?\n$/, '');
    if (fence) {
      code += raw;
      if (closesMarkdownFence(line, fence, maxFenceIndent)) {
        content += fences ? hide(code) : code;
        code = '';
        fence = undefined;
      }
      continue;
    }
    fence = openingMarkdownFence(line, maxFenceIndent);
    if (fence) {
      content += protectInline(prose);
      prose = '';
      code = raw;
    } else prose += raw;
  }
  content += code ? (fences ? hide(code) : code) : protectInline(prose);
  return {
    content,
    restore: (value: string) => literals.reduce((text, literal, index) => text.replaceAll(`${prefix}${index}\uE001`, () => literal), value),
  };
};
