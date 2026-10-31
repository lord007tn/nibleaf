import { protectMarkdownCode } from '@nibleaf/shared/markdown-code';
export interface ImportReference {
  value: string;
  start: number;
  end: number;
  image: boolean;
}

export const markdownReferences = (source: string): ImportReference[] => {
  const pairs = new Map<number, number>();
  const brackets: number[] = [];
  const parentheses: number[] = [];
  for (let index = 0; index < source.length; index++) {
    const character = source[index];
    if (character === '\\') {
      index++;
      continue;
    }
    if (character === '[') brackets.push(index);
    else if (character === ']' && brackets.length) pairs.set(brackets.pop() ?? 0, index);
    else if (character === '(') parentheses.push(index);
    else if (character === ')' && parentheses.length) pairs.set(parentheses.pop() ?? 0, index);
  }
  const references: ImportReference[] = [];
  for (let index = 0; index < source.length; index++) {
    if (source[index] === '\\') {
      index++;
      continue;
    }
    if (source[index] !== '[') continue;
    const labelEnd = pairs.get(index);
    if (labelEnd === undefined || source[labelEnd + 1] !== '(') continue;
    const end = pairs.get(labelEnd + 1);
    if (end === undefined) continue;
    const image = index > 0 && source[index - 1] === '!';
    let start = labelEnd + 2;
    let referenceEnd = end;
    if (source[start] === '<') {
      const angle = source.indexOf('>', start + 1);
      if (angle < 0 || angle >= end) {
        index = end;
        continue;
      }
      start++;
      referenceEnd = angle;
    } else {
      for (let offset = start; offset < end; offset++) {
        if (/\s/.test(source[offset] ?? '')) {
          referenceEnd = offset;
          break;
        }
      }
    }
    const suffix = source.slice(referenceEnd + (source[referenceEnd] === '>' ? 1 : 0), end).trim();
    if (referenceEnd > start && (!suffix || ((suffix[0] === '"' || suffix[0] === "'") && suffix.at(-1) === suffix[0]))) {
      references.push({ value: source.slice(start, referenceEnd), start, end: referenceEnd, image });
    }
    index = end;
  }
  return references;
};

export const replaceImportReferences = (
  source: string,
  references: readonly ImportReference[],
  rewrite: (reference: ImportReference) => string,
): string => {
  const output: string[] = [];
  let cursor = 0;
  for (const reference of references) {
    output.push(source.slice(cursor, reference.start), rewrite(reference));
    cursor = reference.end;
  }
  output.push(source.slice(cursor));
  return output.join('');
};

export const htmlImageReferences = (source: string): ImportReference[] => {
  const references: ImportReference[] = [];
  for (const tag of source.matchAll(/<(?:img|Image)\b[^<>]*>/gi)) {
    const attribute = /\bsrc\s*=\s*(["'])([^"']*)["']/i.exec(tag[0]);
    if (!attribute) continue;
    const value = attribute[2] ?? '';
    const quote = attribute[0].indexOf(attribute[1] ?? '"');
    const start = tag.index + attribute.index + quote + 1;
    references.push({ value, start, end: start + value.length, image: true });
  }
  return references;
};

export const remoteImageSources = (content: string): string[] => {
  const prose = protectMarkdownCode(content).content;
  return [
    ...new Set(
      [...markdownReferences(prose).filter((reference) => reference.image), ...htmlImageReferences(prose)]
        .map((reference) => reference.value)
        .filter((value) => /^https?:\/\//i.test(value)),
    ),
  ];
};
