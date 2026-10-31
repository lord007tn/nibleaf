export interface LiquidToken {
  start: number;
  end: number;
  name: string;
  attributes: string;
}

export const liquidTokens = (source: string): LiquidToken[] => {
  const tokens: LiquidToken[] = [];
  let cursor = 0;
  while (cursor < source.length) {
    let start = source.indexOf('{%', cursor);
    if (start < 0) break;
    const end = source.indexOf('%}', start + 2);
    if (end < 0) break;
    let nested = source.indexOf('{%', start + 2);
    while (nested >= 0 && nested < end) {
      start = nested;
      nested = source.indexOf('{%', start + 2);
    }
    const inner = source
      .slice(start + 2, end)
      .trim()
      .replace(/^-|-$/g, '')
      .trim();
    const match = /^([\w-]+)/.exec(inner);
    if (match) tokens.push({ start, end: end + 2, name: match[1] ?? '', attributes: inner.slice(match[0].length).trim() });
    cursor = end + 2;
  }
  return tokens;
};

export const liquidPairs = (tokens: readonly LiquidToken[]): Map<number, number> => {
  const stacks = new Map<string, number[]>();
  const pairs = new Map<number, number>();
  for (const [index, token] of tokens.entries()) {
    if (token.name.startsWith('end')) {
      const opening = stacks.get(token.name.slice(3))?.pop();
      if (opening !== undefined) {
        pairs.set(opening, index);
        pairs.set(index, opening);
      }
    } else {
      const stack = stacks.get(token.name) ?? [];
      stack.push(index);
      stacks.set(token.name, stack);
    }
  }
  return pairs;
};

export const stripHeadingEnd = (line: string): string => {
  let end = line.length;
  const space = (character: string | undefined) => character === ' ' || character === '\t' || character === '\r';
  while (end > 0 && space(line[end - 1])) end--;
  while (end > 0 && line[end - 1] === '#') end--;
  while (end > 0 && space(line[end - 1])) end--;
  return line.slice(0, end);
};
