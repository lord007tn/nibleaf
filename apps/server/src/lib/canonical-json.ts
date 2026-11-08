import { createHash } from 'node:crypto';

const isPlainObject = (value: unknown): value is Record<string, unknown> => Object.prototype.toString.call(value) === '[object Object]';

/** Key-order independent JSON; `undefined` members are dropped like JSON.stringify does. */
const canonicalJson = (value: unknown): string => {
  if (Array.isArray(value)) return `[${value.map((item) => canonicalJson(item ?? null)).join(',')}]`;
  if (isPlainObject(value)) {
    const entries = Object.entries(value)
      .filter(([, item]) => item !== undefined)
      .sort(([left], [right]) => (left < right ? -1 : left > right ? 1 : 0))
      .map(([key, item]) => `${JSON.stringify(key)}:${canonicalJson(item)}`);
    return `{${entries.join(',')}}`;
  }
  return JSON.stringify(value ?? null);
};

export const sha256Hex = (value: string) => createHash('sha256').update(value, 'utf8').digest('hex');

export const canonicalHash = (value: unknown) => sha256Hex(canonicalJson(value));
