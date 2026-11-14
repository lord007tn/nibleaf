import { vi } from 'vitest';
import type { ImportReference } from '../import-references';
import type { rewriteMainInternalLinks } from './page-links.main-reference';

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
}

const trace = vi.hoisted(() => ({ active: undefined as TraceState | undefined }));
const href = /(\bhref\s*=\s*["'])([^"']+)(["'])/gi;

const record = (state: TraceState, start: number, end: number) => {
  const originalStart = state.offsets[start] ?? 0;
  const originalEnd = state.offsets[end] ?? originalStart;
  state.visits.push({ page: state.page, byteOffset: state.bytes[originalStart] ?? 0, original: state.source.slice(originalStart, originalEnd) });
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
    replaceImportReferences: (source: string, references: readonly ImportReference[], rewrite: (reference: ImportReference) => string) => {
      const state = trace.active;
      if (!state) return actual.replaceImportReferences(source, references, rewrite);
      const edits: Array<{ start: number; end: number; value: string }> = [];
      const output = actual.replaceImportReferences(source, references, (reference) => {
        record(state, reference.start, reference.end);
        const value = rewrite(reference);
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
  const state: TraceState = { source, page, bytes, offsets: new Int32Array(), visits: [] };
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
          record(state, offset, offset + destination.length);
          return Reflect.apply(replacement, undefined, parts);
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
    return { output, visits, reports };
  } finally {
    trace.active = undefined;
    spy.mockRestore();
  }
};
