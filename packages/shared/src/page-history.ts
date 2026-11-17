import { exceedsUtf8Bytes } from './page-limits';

/** Bounds apply before splitting, parsing, or allocating diff output. */
export const PAGE_DIFF_MAX_BYTES = 128 * 1024;
export const PAGE_DIFF_MAX_LINES = 2000;
export const PAGE_REVISION_MAX_BYTES = 512 * 1024;
export const PAGE_HISTORY_MAX_BYTES = 10 * 1024 * 1024;
export const PAGE_HISTORY_IDLE_MS = 10 * 60 * 1000;
export const PAGE_HISTORY_INTERVAL_MS = 30 * 60 * 1000;

export type PageLineDiff =
  | { status: 'too-large'; limit: 'bytes' | 'lines' }
  | { status: 'equal' | 'changed'; lines: Array<{ kind: 'same' | 'removed' | 'added'; text: string }> };

export function pageDiffLimit(text: string): 'bytes' | 'lines' | null {
  if (exceedsUtf8Bytes(text, PAGE_DIFF_MAX_BYTES)) return 'bytes';
  let lines = 1;
  for (let i = 0; i < text.length; i++) {
    if (text.charCodeAt(i) === 10 && ++lines > PAGE_DIFF_MAX_LINES) return 'lines';
  }
  return null;
}

/** Linear line diff: retain the common prefix/suffix, replace the middle.
 * Deliberately not LCS/Myers: repeated or entirely different lines must never
 * trigger quadratic matching. Output is at most twice the input bounds. */
export function diffPageLines(before: string, after: string): PageLineDiff {
  const limit = pageDiffLimit(before) ?? pageDiffLimit(after);
  if (limit) return { status: 'too-large', limit };
  const left = before.split('\n');
  const right = after.split('\n');
  let start = 0;
  while (start < left.length && start < right.length && left[start] === right[start]) start++;
  let end = 0;
  while (end < left.length - start && end < right.length - start && left[left.length - 1 - end] === right[right.length - 1 - end]) end++;
  return {
    status: before === after ? 'equal' : 'changed',
    lines: [
      ...left.slice(0, start).map((text) => ({ kind: 'same' as const, text })),
      ...left.slice(start, left.length - end).map((text) => ({ kind: 'removed' as const, text })),
      ...right.slice(start, right.length - end).map((text) => ({ kind: 'added' as const, text })),
      ...left.slice(left.length - end).map((text) => ({ kind: 'same' as const, text })),
    ],
  };
}

export interface PageHistoryEntry {
  id: string;
  source: 'revision' | 'published';
  title: string;
  createdAt: string;
  contentBytes: number;
  author: string | null;
  reason: 'autosave' | 'before-restore' | null;
  version: number | null;
}

/** When a Trash restore could not bring back all of a page's history: how many
 *  revisions came back, of how many, and when (#492). */
export interface PageHistoryTrimmedFromTrash {
  kept: number;
  total: number;
  at: string;
}

export interface PageHistoryComparison {
  expectedUpdatedAt: string;
  title: { before: string; after: string };
  diff: PageLineDiff;
}
