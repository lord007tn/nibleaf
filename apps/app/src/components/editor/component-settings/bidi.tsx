import type { ReactNode } from 'react';

// First-strong isolate and pop directional isolate (U+2068, U+2069).
const FSI = String.fromCharCode(0x20_68);
const PDI = String.fromCharCode(0x20_69);

/**
 * Isolate a value inside a translated string used as an attribute (aria-label,
 * title): the plain-text form of `<bdi>`. Without it an LTR value in an Arabic
 * sentence ("credit-card :تغيير الأيقونة") drags the punctuation next to it to
 * the wrong side.
 */
export const isolate = (value: string): string => `${FSI}${value}${PDI}`;

// Private-use characters (U+E000, U+E001) mark where each value goes; translations never contain them.
const SLOT_OPEN = String.fromCharCode(0xe0_00);
const SLOT_CLOSE = String.fromCharCode(0xe0_01);
const SLOT = new RegExp(`${SLOT_OPEN}(\\d+)${SLOT_CLOSE}`);

/**
 * A translated sentence with its interpolated values (icon names, paths, hex
 * colours…) rendered in `<bdi>`, so each keeps its own direction inside text in
 * the other direction.
 */
export function IsolatedText({ translate, values }: { translate: (slots: Record<string, string>) => string; values: Record<string, string> }) {
  const names = Object.keys(values);
  const parts = translate(Object.fromEntries(names.map((name, index) => [name, `${SLOT_OPEN}${index}${SLOT_CLOSE}`]))).split(SLOT);
  let slot = 0;
  const nodes: ReactNode[] = parts.map((part, index) => {
    if (index % 2 === 0) return part;
    const name = names[Number(part)];
    slot += 1;
    return name === undefined ? null : <bdi key={`${name}-${slot}`}>{values[name]}</bdi>;
  });
  return <>{nodes}</>;
}
