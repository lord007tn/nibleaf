import { expect, vi } from 'vitest';
import type { ImportReference } from '../import-references';
import type { rewriteMainInternalLinks } from './page-links.main-reference';
import { markdownReferences as mainReferences } from './page-links.main-references';

interface DestinationVisit {
  page: string;
  byteOffset: number;
  original: string;
}

interface TraceState {
  source: string;
  page: string;
  offsets: Int32Array;
  bytes: Int32Array;
  visits: DestinationVisit[];
  rewrites: Array<DestinationVisit & { target: string }>;
}

const trace = vi.hoisted(() => ({ active: undefined as TraceState | undefined, mainScanner: false }));
const href = /(\bhref\s*=\s*["'])([^"']+)(["'])/gi;

const record = (state: TraceState, start: number, end: number) => {
  const originalStart = state.offsets[start] ?? 0;
  const originalEnd = state.offsets[end] ?? originalStart;
  const visit = { page: state.page, byteOffset: state.bytes[originalStart] ?? 0, original: state.source.slice(originalStart, originalEnd) };
  state.visits.push(visit);
  return visit;
};

vi.mock('../import-markdown-code', async (original) => {
  const actual = await original<typeof import('../import-markdown-code')>();
  return {
    ...actual,
    protectImportCode: (source: string) => {
      const protectedCode = actual.protectImportCode(source);
      const state = trace.active;
      if (!state) return protectedCode;
      // Both main code protectors use private-use placeholders. Expand each
      // once to map scanner positions back to the original UTF-16 source.
      const offsets = new Int32Array(protectedCode.content.length + 1);
      let cursor = 0;
      let restored = 0;
      for (const token of protectedCode.content.matchAll(/\uE000[^\uE001]+\uE001\n?/g)) {
        while (cursor < token.index) offsets[cursor++] = restored++;
        const end = token.index + token[0].length;
        while (cursor < end) offsets[cursor++] = restored;
        restored += protectedCode.restore(token[0]).length;
      }
      while (cursor < protectedCode.content.length) offsets[cursor++] = restored++;
      offsets[cursor] = restored;
      state.offsets = offsets;
      return protectedCode;
    },
  };
});

vi.mock('../import-references', async (original) => {
  const actual = await original<typeof import('../import-references')>();
  return {
    ...actual,
    markdownReferences: (source: string) => (trace.mainScanner ? mainReferences(source) : actual.markdownReferences(source)),
    replaceImportReferences: (source: string, references: readonly ImportReference[], rewrite: (reference: ImportReference) => string) => {
      const state = trace.active;
      if (!state) return actual.replaceImportReferences(source, references, rewrite);
      const edits: Array<{ start: number; end: number; value: string }> = [];
      const output = actual.replaceImportReferences(source, references, (reference) => {
        const visit = record(state, reference.start, reference.end);
        const value = rewrite(reference);
        if (value !== reference.value) state.rewrites.push({ ...visit, target: value });
        edits.push({ start: reference.start, end: reference.end, value });
        return value;
      });
      // Main's href pass runs after Markdown replacements. Preserve the original
      // boundary positions, including href values containing Markdown links.
      const offsets = new Int32Array(output.length + 1);
      let input = 0;
      let written = 0;
      for (const edit of edits) {
        while (input < edit.start) offsets[written++] = state.offsets[input++] ?? 0;
        const unchanged = edit.value === source.slice(edit.start, edit.end);
        for (let index = 0; index < edit.value.length; index++) offsets[written++] = state.offsets[edit.start + (unchanged ? index : 0)] ?? 0;
        input = edit.end;
      }
      while (input < source.length) offsets[written++] = state.offsets[input++] ?? 0;
      offsets[written] = state.offsets[source.length] ?? 0;
      state.offsets = offsets;
      return output;
    },
  };
});

/** Run the unchanged GitBook converter with main's independent scanner too. */
export const withMainLinkScanner = <T>(run: () => T): T => {
  const previous = trace.mainScanner;
  trace.mainScanner = true;
  try {
    return run();
  } finally {
    trace.mainScanner = previous;
  }
};

/** Observe the real main/head traversal; no discovery code is reproduced here. */
export const traceLinkDiscovery = (
  rewrite: typeof rewriteMainInternalLinks,
  source: string,
  page: string,
  routes: ReadonlyMap<string, string>,
  options: Parameters<typeof rewriteMainInternalLinks>[3] = {},
) => {
  const bytes = new Int32Array(source.length + 1);
  let character = 0;
  let byte = 0;
  for (const point of source) {
    bytes[character] = byte;
    character += point.length;
    byte += Buffer.byteLength(point);
  }
  bytes[character] = byte;
  const state: TraceState = { source, page, bytes, offsets: new Int32Array(), visits: [], rewrites: [] };
  const reports: string[] = [];
  const native = String.prototype.replace;
  const spy = vi.spyOn(String.prototype, 'replace').mockImplementation(function (this: string, ...args: Parameters<string['replace']>): string {
    const [pattern, replacement] = args;
    if (pattern instanceof RegExp && pattern.source === href.source && typeof replacement === 'function') {
      return Reflect.apply(native, this, [
        pattern,
        (...parts: unknown[]) => {
          const before = String(parts[1]);
          const destination = String(parts[2]);
          const offset = Number(parts[4]) + before.length;
          const visit = record(state, offset, offset + destination.length);
          const result = Reflect.apply(replacement, undefined, parts) as string;
          const target = new RegExp(href.source, 'i').exec(result)?.[2];
          if (target !== undefined && target !== destination) state.rewrites.push({ ...visit, target });
          return result;
        },
      ]);
    }
    return Reflect.apply(native, this, args);
  });
  trace.active = state;
  try {
    const output = rewrite(source, page, routes, { ...options, onUnresolved: (value) => reports.push(value) });
    const visits = [...new Map(state.visits.map((visit) => [JSON.stringify(visit), visit])).values()].sort(
      (left, right) => left.byteOffset - right.byteOffset || left.original.localeCompare(right.original),
    );
    const rewrites = [...new Map(state.rewrites.map((change) => [JSON.stringify(change), change])).values()].sort(
      (left, right) => left.byteOffset - right.byteOffset || left.original.localeCompare(right.original) || left.target.localeCompare(right.target),
    );
    return { output, visits, rewrites, reports };
  } finally {
    trace.active = undefined;
    spy.mockRestore();
  }
};

/** Preserve every old visit and only permit added edits at authored definitions. */
export const assertDefinitionDiscoveryDelta = (
  source: string,
  main: ReturnType<typeof traceLinkDiscovery>,
  head: ReturnType<typeof traceLinkDiscovery>,
) => {
  const visitKey = ({ page, byteOffset, original }: DestinationVisit) => JSON.stringify([page, byteOffset, original]);
  const mainKeys = new Set(main.visits.map(visitKey));
  expect(head.visits.filter((visit) => mainKeys.has(visitKey(visit)))).toEqual(main.visits);
  expect(head.rewrites.filter((edit) => mainKeys.has(visitKey(edit)))).toEqual(main.rewrites);

  const encoded = Buffer.from(source);
  for (const visit of head.visits)
    expect(encoded.subarray(visit.byteOffset, visit.byteOffset + Buffer.byteLength(visit.original)).toString()).toBe(visit.original);
  const newVisits = head.visits.filter((visit) => !mainKeys.has(visitKey(visit)));
  const prefixes = new Map<string, string>();
  for (const visit of newVisits) {
    const before = encoded.subarray(0, visit.byteOffset).toString();
    const prefix = before.slice(before.lastIndexOf('\n') + 1);
    expect(prefix).toMatch(/^\s*(?:[>-]\s+)*\[[^\]\n]+\]:\s*<?$/);
    prefixes.set(visitKey(visit), prefix);
  }

  let expected = main.output;
  for (const edit of head.rewrites) {
    const prefix = prefixes.get(visitKey(edit));
    if (prefix === undefined) continue;
    expect(expected).toContain(prefix + edit.original);
    expected = expected.replace(prefix + edit.original, prefix + edit.target);
  }
  expect(head.output).toBe(expected);
  let report = 0;
  for (const value of head.reports) if (value === main.reports[report]) report++;
  expect(report).toBe(main.reports.length);
  return { expected, definitions: newVisits.length };
};
