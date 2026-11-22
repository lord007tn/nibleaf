import { createHash } from 'node:crypto';
import { describe, expect, it, vi } from 'vitest';
import { collectPageContentFacts } from './page-content-facts';
import { pageContentFacts } from './publish-checks';

/*
 * #908: malformed raw HTML must never crash the publish checks. A `<template>` inside
 * `<svg>` or `<math>` is an ordinary foreign element with no template contents, but
 * hast-util-from-parse5 8.0.3 (under rehype-raw) read its contents anyway and threw
 * `Cannot read properties of undefined (reading 'nodeName')`. 8.0.4 reads contents only
 * for HTML templates and keeps a foreign template's children as children. The facts
 * treat only an HTML template as a non-link context, the way the reader renders them.
 *
 * The corpus is seeded tag soup built from the tokens of the reported page. Its digest
 * was recorded on main (hast-util-from-parse5 8.0.3): the facts of every input that
 * parsed there must stay exactly the same, and the inputs that threw must now parse.
 */

// A generated corpus; on a loaded runner a few hundred parses can pass the 5 s default.
vi.setConfig({ testTimeout: 60_000 });

const REPORTED =
  '\n\ntext<td></iframe></script><img src="/a.png"><p><math><p><a href="/missing"></font><svg><div></table></script><svg><template><svg></a><code><font><font><code><option>\n';

const TOKENS = [
  'text',
  '\n\n',
  '<td>',
  '</iframe>',
  '</script>',
  '<img src="/a.png">',
  '<img src="/b.png" alt="B">',
  '<p>',
  '</p>',
  '<math>',
  '</math>',
  '<a href="/missing">',
  '<a href="/docs/start">',
  '</a>',
  '</font>',
  '<font>',
  '<svg>',
  '</svg>',
  '<div>',
  '</div>',
  '<table>',
  '</table>',
  '<tr>',
  '<template>',
  '</template>',
  '<code>',
  '<option>',
  '<select>',
  '<foreignObject>',
  '<textarea>',
  '<title>',
  '<!-- note -->',
  '[guide](/guide)',
  '/',
];

/** mulberry32: a small seeded generator, so the corpus is the same on every run. */
const seeded = (seed: number) => {
  let state = seed;
  return () => {
    state = (state + 0x6d_2b_79_f5) | 0;
    let t = Math.imul(state ^ (state >>> 15), 1 | state);
    t ^= t + Math.imul(t ^ (t >>> 7), 61 | t);
    return ((t ^ (t >>> 14)) >>> 0) / 4_294_967_296;
  };
};

const corpus = (seed: number, size: number): string[] => {
  const random = seeded(seed);
  return Array.from({ length: size }, () => {
    const length = 3 + Math.floor(random() * 22);
    return Array.from({ length }, () => TOKENS[Math.floor(random() * TOKENS.length)]).join('');
  });
};

const CORPUS = corpus(908, 600);
/** Inputs of CORPUS that threw on main, by index. */
const THREW_ON_MAIN = [38, 39, 62, 77, 89, 145, 189, 194, 202, 220, 228, 259, 270, 295, 352, 358, 387, 436, 439, 485, 506, 546, 547, 593];
/** sha256 over the facts of the other 576 inputs of CORPUS, as main collected them. */
const MAIN_DIGEST = 'ce952283dfdf0e2bc7a808b66c1bd885db1fc3a2729165736363eb87764319a3';

const factsDigest = (indices: number[]) => {
  const hash = createHash('sha256');
  for (const index of indices) hash.update(`${index}:${JSON.stringify(collectPageContentFacts(CORPUS[index] as string))}\n`);
  return hash.digest('hex');
};

describe('page content facts on malformed tag soup (#908)', () => {
  it('reads the reported page without throwing', () => {
    expect(() => pageContentFacts(REPORTED, false)).not.toThrow();
  });

  it.each(['<svg><template></template></svg>', '<math><template></template></math>', 'a <svg><template></svg> b'])(
    'reads a foreign template without throwing: %j',
    (content) => {
      expect(() => collectPageContentFacts(content)).not.toThrow();
    },
  );

  // The reader renders `<a href="/inside">x</a>` for both foreign templates (its
  // sanitizer unwraps svg, math and template), and nothing for an HTML template.
  it.each(['<svg><template><a href="/inside">x</a></template></svg>\n', '<math><template><a href="/inside">x</a></template></math>\n'])(
    'reads the links in a foreign template as the reader renders them: %j',
    (content) => {
      expect(collectPageContentFacts(content).links).toEqual(['/inside']);
    },
  );

  it('still reads no links inside an HTML template', () => {
    expect(collectPageContentFacts('<template><a href="/inside">x</a></template>\n').links).toEqual([]);
    expect(collectPageContentFacts('<div><template><a href="/inside">x</a></template></div>\n').links).toEqual([]);
  });

  it('reads every input of a seeded tag-soup corpus', () => {
    const failures = CORPUS.flatMap((content, index) => {
      try {
        collectPageContentFacts(content);
        return [];
      } catch (error) {
        return [`${index}: ${(error as Error).message}`];
      }
    });
    expect(failures).toEqual([]);
    expect(THREW_ON_MAIN.length).toBeGreaterThan(10);
  });

  it("keeps main's facts for every corpus input that parsed on main", () => {
    const parsed = CORPUS.map((_, index) => index).filter((index) => !THREW_ON_MAIN.includes(index));
    expect(parsed.length).toBeGreaterThan(400);
    expect(factsDigest(parsed)).toBe(MAIN_DIGEST);
  });
});
