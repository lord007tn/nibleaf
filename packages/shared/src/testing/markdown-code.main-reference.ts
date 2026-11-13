/**
 * FROZEN TEST REFERENCE, never imported by product code.
 *
 * `fencedMarkdownLines` exactly as it was on main 83fa966f, before fences in
 * quotes and list items tracked their containers (#587). The corpus and
 * property tests compare the current scanner with it, so ordinary pages are
 * shown to be unchanged and main's overruns stay countable. Do not update it.
 */
import { closesMarkdownFence, type MarkdownFence, openingMarkdownFence } from '../markdown-code';

const MAIN_CONTAINER_PREFIX = /^ {0,3}(?:> ?)*(?: {0,3}(?:[-*+]|\d{1,9}[.)]) {1,4})?/;

export const mainFencedMarkdownLines = (lines: readonly string[]): boolean[] => {
  let fence: MarkdownFence | undefined;
  return lines.map((line) => {
    const content = line.replace(MAIN_CONTAINER_PREFIX, '');
    if (fence) {
      if (closesMarkdownFence(content, fence, Number.POSITIVE_INFINITY)) fence = undefined;
      return true;
    }
    fence = openingMarkdownFence(content, Number.POSITIVE_INFINITY);
    return Boolean(fence);
  });
};
