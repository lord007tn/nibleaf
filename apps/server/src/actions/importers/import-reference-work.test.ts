import { expect, it, vi } from 'vitest';
import { markdownReferences as mainReferences } from './fixtures/page-links.main-references';
import { markdownReferences } from './import-references';

// Instrument the real scanner, including indexed reads and characters sliced.
// No counters or optional diagnostic API are needed in production.
const work = (scan: typeof markdownReferences, input: string) => {
  let characters = 0;
  let pairs = 0;
  const source = new Proxy(
    { length: input.length },
    {
      get(target, key) {
        if (typeof key === 'string' && /^-?\d+$/.test(key)) {
          characters++;
          return input[Number(key)];
        }
        if (key === 'slice')
          return (start: number, end?: number) => {
            const value = input.slice(start, end);
            characters += value.length;
            return value;
          };
        const value = key === 'length' ? target.length : Reflect.get(String.prototype, key);
        return typeof value === 'function' ? value.bind(input) : value;
      },
    },
  );
  const native = Map.prototype.set;
  const spy = vi.spyOn(Map.prototype, 'set').mockImplementation(function (this: Map<unknown, unknown>, key: unknown, value: unknown) {
    if (typeof key === 'number' && typeof value === 'number') pairs++;
    return native.call(this, key, value);
  });
  try {
    const references = scan(source as unknown as string);
    return { references, characters, pairs };
  } finally {
    spy.mockRestore();
  }
};

it.each(['[a](<b)', '['])('bounds real scanner work at n, 2n, 4n and 8n: %s', (unit) => {
  for (const n of [32 * 1024, 64 * 1024, 128 * 1024, 256 * 1024]) {
    const source = `${unit.repeat(Math.ceil(n / unit.length)).slice(0, n)}\n\n<Note>\n[Go](/next)\n</Note>`;
    const main = work(mainReferences, source);
    const head = work(markdownReferences, source);
    expect(head.references).toEqual(main.references);
    console.info('reference work', {
      unit,
      n,
      main: { characters: main.characters, pairs: main.pairs },
      head: { characters: head.characters, pairs: head.pairs },
    });
    // Character work is linear on both revisions. Pair retention, rather than
    // repeated tail scanning, is the regression assertion that fails on main.
    expect(main.characters).toBeLessThanOrEqual(2 * source.length + 64);
    expect(head.characters).toBeLessThanOrEqual(2 * source.length + 64);
    expect(head.pairs).toBeLessThanOrEqual(4);
  }
});
