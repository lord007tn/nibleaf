import { protectMarkdownCode } from './markdown-code';

/**
 * Literal JSX attribute values (`cols={3}`, `defaultOpen={false}`,
 * `tags={["Feature", "Fix"]}`) as Mintlify authors write them. These helpers
 * only READ literals: anything that is not a plain number, boolean, string or
 * array of string literals is reported as "not a literal" and left to the
 * caller to keep verbatim. Nothing here ever evaluates code.
 */
export type MdxLiteral = string | number | boolean | readonly string[];

const NUMBER = /^-?(?:\d+(?:\.\d+)?|\.\d+)$/;

/** Read one quoted string literal starting at `start`; returns its value and end index. */
function readStringLiteral(source: string, start: number): { value: string; end: number } | undefined {
  const quote = source[start];
  if (quote !== '"' && quote !== "'" && quote !== '`') return undefined;
  let value = '';
  for (let index = start + 1; index < source.length; index++) {
    const char = source[index] ?? '';
    if (char === quote) return { value, end: index + 1 };
    if (quote === '`' && char === '$' && source[index + 1] === '{') return undefined;
    if (char === '\n' && quote !== '`') return undefined;
    if (char !== '\\') {
      value += char;
      continue;
    }
    const next = source[++index];
    if (next === undefined) return undefined;
    if (next === 'n') value += '\n';
    else if (next === 't') value += '\t';
    else if (next === 'r') value += '\r';
    else if (next === 'u' && /^[0-9a-fA-F]{4}$/.test(source.slice(index + 1, index + 5))) {
      value += String.fromCharCode(Number.parseInt(source.slice(index + 1, index + 5), 16));
      index += 4;
    } else value += next;
  }
  return undefined;
}

const skipSpace = (source: string, index: number): number => {
  let cursor = index;
  while (/\s/.test(source[cursor] ?? '')) cursor++;
  return cursor;
};

/** Parse the inside of a JSX expression (without braces) when it is a plain literal. */
function parseLiteral(expression: string): MdxLiteral | undefined {
  const text = expression.trim();
  if (NUMBER.test(text)) return Number(text);
  if (text === 'true') return true;
  if (text === 'false') return false;
  const string = readStringLiteral(text, 0);
  if (string) return string.end === text.length ? string.value : undefined;
  if (!text.startsWith('[') || !text.endsWith(']')) return undefined;
  const items: string[] = [];
  let cursor = skipSpace(text, 1);
  while (cursor < text.length - 1) {
    const item = readStringLiteral(text, cursor);
    if (!item) return undefined;
    items.push(item.value);
    cursor = skipSpace(text, item.end);
    if (text[cursor] === ',') cursor = skipSpace(text, cursor + 1);
    else if (cursor !== text.length - 1) return undefined;
  }
  return items;
}

/** `{3}` → 3, `{["a"]}` → ["a"]; anything that is not a braced plain literal → undefined. */
export function parseMdxLiteralExpression(source: string): MdxLiteral | undefined {
  const text = source.trim();
  if (!text.startsWith('{') || !text.endsWith('}')) return undefined;
  return parseLiteral(text.slice(1, -1));
}

/** The canonical JSX spelling of a literal: `{3}`, `{false}`, `{["a", "b"]}`. */
export function formatMdxLiteralExpression(value: number | boolean | readonly string[]): string {
  if (Array.isArray(value)) return `{[${value.map((item) => JSON.stringify(item)).join(', ')}]}`;
  return `{${String(value)}}`;
}

/** Read an authored list attribute: a JSON/JSX array of strings, or one plain value. */
export function parseMdxList(value: unknown): string[] {
  if (Array.isArray(value)) return value.filter((item): item is string => typeof item === 'string');
  if (typeof value !== 'string') return [];
  const text = value.trim();
  if (!text) return [];
  if (text.startsWith('{')) {
    const literal = parseMdxLiteralExpression(text);
    if (Array.isArray(literal)) return [...literal];
    return typeof literal === 'string' ? [literal] : [];
  }
  if (text.startsWith('[')) {
    const literal = parseLiteral(text);
    return Array.isArray(literal) ? [...literal] : [];
  }
  return [text];
}

const escapeAttribute = (value: string): string =>
  value.replaceAll('&', '&amp;').replaceAll('"', '&quot;').replaceAll('<', '&lt;').replaceAll('>', '&gt;');

const htmlAttributeValue = (literal: MdxLiteral): string => escapeAttribute(Array.isArray(literal) ? JSON.stringify(literal) : String(literal));

// A component opening tag whose attributes hold only quoted strings and
// single-level braces. Anything more complex (nested objects, JSX) fails to
// match and is left exactly as authored.
const OPENING_TAG = /<([A-Z][A-Za-z0-9]*)((?:\s(?:[^>"'{}]|"[^"]*"|'[^']*'|\{(?:[^{}"']|"[^"]*"|'[^']*')*\})*)?)(\/?)>/g;
const EXPRESSION_ATTRIBUTE = /(\s)([A-Za-z_][\w.:-]*)\s*=\s*(\{(?:[^{}"']|"[^"]*"|'[^']*')*\})/g;
// HTML reads these by presence alone, so `required="false"` would mean required.
// A `{false}` literal on one of them is dropped instead (absent is false).
const HTML_BOOLEAN_ATTRIBUTES = new Set(['checked', 'disabled', 'hidden', 'multiple', 'open', 'readonly', 'required', 'selected']);

/**
 * Turn literal JSX expression attributes on the given component tags into
 * plain HTML attributes before the reader's HTML parse: `cols={3}` → `cols="3"`,
 * `defaultOpen={false}` → `defaultOpen="false"`, `tags={["A"]}` →
 * `tags="[&quot;A&quot;]"`. Non-literal expressions, unknown tags and code are
 * left untouched.
 */
export function literalJsxAttributesToHtml(source: string, isComponent: (tag: string) => boolean): string {
  if (!source.includes('={')) return source;
  // Authors indent fences inside components, so any indentation still opens one.
  const code = protectMarkdownCode(source, { maxFenceIndent: Number.POSITIVE_INFINITY });
  const rewritten = code.content.replace(OPENING_TAG, (tag: string, name: string, attributes: string, slash: string) => {
    if (!attributes || !isComponent(name)) return tag;
    const next = attributes.replace(EXPRESSION_ATTRIBUTE, (attribute: string, space: string, attributeName: string, expression: string) => {
      const literal = parseMdxLiteralExpression(expression);
      if (literal === undefined) return attribute;
      if (literal === false && HTML_BOOLEAN_ATTRIBUTES.has(attributeName.toLowerCase())) return '';
      return `${space}${attributeName}="${htmlAttributeValue(literal)}"`;
    });
    return `<${name}${next}${slash}>`;
  });
  return code.restore(rewritten);
}
