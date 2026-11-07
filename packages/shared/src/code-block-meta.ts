export interface CodeBlockMeta {
  language: string;
  title: string;
  icon: string;
  highlight: number[];
  focus: number[];
  lines: boolean;
  wrap: boolean;
  expandable: boolean;
  nocopy: boolean;
  rest: string[];
}

/** Bounded, positive line ranges. Invalid input is distinct from an empty field. */
export function parseCodeLines(value: string): number[] | null {
  if (!value.trim()) return [];
  const result = new Set<number>();
  for (const part of value.split(',')) {
    const match = /^\s*(\d+)\s*(?:-\s*(\d+)\s*)?$/.exec(part);
    if (!match) return null;
    const start = Number(match[1]);
    const end = Number(match[2] ?? start);
    if (start < 1 || end < start || end > 10_000) return null;
    for (let line = start; line <= end; line++) result.add(line);
  }
  return [...result].sort((a, b) => a - b);
}

const flags = ['lines', 'wrap', 'expandable', 'nocopy'] as const;
const unquote = (value: string) => (/^["'{]/.test(value) ? value.slice(1, -1).replace(/\\([\\"'])/g, '$1') : value);

function tokens(source: string) {
  const matches = [...source.matchAll(/(?:[^\s"'{}]+|"(?:\\.|[^"\\])*"|'(?:\\.|[^'\\])*'|\{[^}]*\})+/g)];
  return matches.map((match, index) => {
    const raw = match[0];
    const equal = raw.indexOf('=');
    const key = equal < 0 ? raw : raw.slice(0, equal);
    const value = equal < 0 ? '' : unquote(raw.slice(equal + 1));
    let kind = 'title';
    if (index === 0 && !flags.includes(key as (typeof flags)[number]) && equal < 0 && !raw.startsWith('{')) kind = 'language';
    else if (flags.includes(key as (typeof flags)[number]) || ['title', 'icon', 'highlight', 'focus', 'theme'].includes(key)) kind = key;
    else if (raw.startsWith('{') && parseCodeLines(unquote(raw)) !== null) kind = 'highlight';
    else if (equal >= 0 || raw === 'twoslash') kind = 'rest';
    return { raw, start: match.index, end: match.index + raw.length, kind, value };
  });
}

export function parseCodeBlockMeta(source: string): CodeBlockMeta {
  const meta: CodeBlockMeta = {
    language: '',
    title: '',
    icon: '',
    highlight: [],
    focus: [],
    lines: false,
    wrap: false,
    expandable: false,
    nocopy: false,
    rest: [],
  };
  const bareTitle: string[] = [];
  for (const token of tokens(source)) {
    const { kind, value, raw } = token;
    if (kind === 'language') meta.language = raw;
    else if (kind === 'title') {
      if (raw.startsWith('title=')) meta.title = value;
      else bareTitle.push(unquote(raw));
    } else if (kind === 'icon') meta.icon = value;
    else if (kind === 'highlight' || kind === 'focus') meta[kind] = parseCodeLines(value || unquote(raw)) ?? [];
    else if (kind === 'lines' || kind === 'wrap' || kind === 'expandable' || kind === 'nocopy') meta[kind] = value !== 'false';
    else if (kind === 'rest') meta.rest.push(raw);
  }
  if (!meta.title) meta.title = bareTitle.join(' ');
  return meta;
}

/** Only changed options are rewritten; untouched spelling, spacing and unknown tokens survive. */
export function serializeCodeBlockMeta(source: string, patch: Partial<Omit<CodeBlockMeta, 'rest'>>): string {
  const original = parseCodeBlockMeta(source);
  const changed = Object.keys(patch).filter(
    (key) => JSON.stringify(original[key as keyof CodeBlockMeta]) !== JSON.stringify(patch[key as keyof typeof patch]),
  );
  if (!changed.length) return source;
  const pending = new Set(changed);
  const format = (key: string) => {
    const value = patch[key as keyof typeof patch];
    if (key === 'language') return String(value || '');
    if (Array.isArray(value)) return value.length ? `${key}={${value.join(',')}}` : '';
    if (typeof value === 'boolean') return value ? key : '';
    return value ? `${key}=${JSON.stringify(String(value).replace(/[\r\n]/g, ' '))}` : '';
  };
  let output = '';
  let cursor = 0;
  for (const token of tokens(source)) {
    output += source.slice(cursor, token.start);
    if (!changed.includes(token.kind)) output += token.raw;
    else if (pending.delete(token.kind)) output += format(token.kind);
    cursor = token.end;
  }
  output += source.slice(cursor);
  for (const key of pending) {
    const value = format(key);
    if (key === 'language') output = value + (output.trim() ? ` ${output.trimStart()}` : '');
    else if (value) output += `${output && !/\s$/.test(output) ? ' ' : ''}${value}`;
  }
  // A language is required before options; plain-text fences use the text grammar.
  if ((patch.language === '' || (!original.language && !patch.language)) && output.trim()) output = `text ${output.trimStart()}`;
  return output;
}

/** Diff directives must be trailing comments, never string literals or standalone prose. */
export function codeDiffLines(source: string): { text: string; diff?: 'add' | 'remove' }[] {
  let remaining = 0;
  let diff: 'add' | 'remove' | undefined;
  return source.split('\n').map((text) => {
    const marker = /\s*(?:\/\/|#|--|<!--|\/\*)\s*\[!code (\+\+|--)(?::(\d+))?\]\s*(?:-->|\*\/)?\s*$/.exec(text);
    if (marker) {
      diff = marker[1] === '++' ? 'add' : 'remove';
      remaining = Math.max(1, Number(marker[2] ?? 1));
    }
    return { text: marker ? text.slice(0, marker.index) : text, diff: remaining-- > 0 ? diff : undefined };
  });
}
