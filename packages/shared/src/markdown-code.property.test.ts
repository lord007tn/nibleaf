import { createHash } from 'node:crypto';
import { expect, it } from 'vitest';
import { fencedMarkdownLines } from './markdown-code';
import { FENCE_CASE_COUNT, FENCE_CASE_SEED, fenceCases } from './testing/fence-cases';
import { mainFencedMarkdownLines } from './testing/markdown-code.main-reference';

const overrunHash = (indices: readonly number[]) => createHash('sha256').update(indices.join(',')).digest('hex');

it('closes every generated fence in quotes and lists before the sentinel, and keeps all its code (seed 0x58236b09)', ({ task }) => {
  const cases = fenceCases();
  expect(cases).toHaveLength(FENCE_CASE_COUNT);
  // The false closers include #587's fifth repro: a tilde fence, a quoted false
  // closer in its body, and a longer real closer, at the top level and in containers.
  const quotedTildeLonger = cases.filter(
    ({ fenced, marker, falseCloser, length, closerLength }) => fenced && marker === '~' && falseCloser === 'new quote' && closerLength > length,
  );
  expect(quotedTildeLonger.filter(({ prefix }) => prefix === '').length).toBeGreaterThan(0);
  expect(quotedTildeLonger.filter(({ prefix }) => prefix !== '').length).toBeGreaterThan(0);
  const overruns: number[] = [];
  const mainOverruns: number[] = [];
  const failures: Array<{ index: number; reason: string; source: string }> = [];
  const containerEnds: number[] = [];
  let unopened = 0;
  for (const generated of cases) {
    const { index, source, codeExample, exampleStart, exampleEnd } = generated;
    const lines = source.split('\n');
    const code = fencedMarkdownLines(lines);
    if (code.at(-1)) overruns.push(index);
    if (mainFencedMarkdownLines(lines).at(-1)) mainOverruns.push(index);
    // Main's scanner on the example alone (no sentinel to overrun into) is an
    // independent oracle: every line it calls code must still be code.
    const oracle = mainFencedMarkdownLines(codeExample.split('\n'));
    if (oracle.some((isCode, line) => isCode && !code[line])) failures.push({ index, reason: 'main code is exposed', source });
    if (!generated.fenced) continue;
    if (code[exampleStart]) {
      if (code.slice(exampleStart, exampleEnd).some((isCode) => !isCode)) containerEnds.push(index);
    } else {
      // A fence indented with a tab, at the start of the line or after its
      // containers, is not recognised (as on main): it is reported, not opened.
      unopened++;
      if (oracle[exampleStart]) failures.push({ index, reason: 'main opened this fence', source });
    }
  }
  Object.assign(task.meta, {
    fenceProperty: {
      seed: `0x${FENCE_CASE_SEED.toString(16)}`,
      cases: cases.length,
      overruns: overruns.length,
      mainOverruns: mainOverruns.length,
      containerEnds: containerEnds.length,
      unopened,
    },
  });
  expect(failures.slice(0, 12), `${failures.length} failures`).toEqual([]);
  expect(overruns).toEqual([]);
  // Every opened example is code to its last line, except two whose generated
  // continuation does not continue the list item: after `>>\t` the tab is two
  // columns wide, after `> >\t` one, so `   [Literal]` falls short of the item's
  // content column and CommonMark (markdown-it agrees) ends the item and the fence.
  expect(containerEnds).toEqual([654, 2924]);
  // Main's count and case indices, the numbers #587 and #582 report.
  expect(mainOverruns).toHaveLength(606);
  expect(overrunHash(mainOverruns)).toBe('6c8f4844c08ba09312743ce66e36ff5986603630ff723a66d5b87f78e3232422');
}, 20_000);
