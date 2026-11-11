/** The largest page body a write may store, in UTF-8 bytes (2 MiB). Editor
 *  saves, MCP writes, import and Git sync share it: public `.md`/llms output and
 *  exports are built from page content. */
export const MAX_PAGE_CONTENT_BYTES = 2 * 1024 * 1024;

const utf8Width = (code: number) => (code <= 0x7f ? 1 : code <= 0x7_ff ? 2 : code <= 0xff_ff ? 3 : 4);

/** Count UTF-8 bytes only up to the limit. Even a huge single line fails early.
 * Unpaired UTF-16 surrogates encode as a three-byte replacement character. */
export function exceedsUtf8Bytes(text: string, limit: number): boolean {
  // Every UTF-16 code unit encodes to at least one byte.
  if (text.length > limit) return true;
  let bytes = 0;
  for (const char of text) {
    bytes += utf8Width(char.codePointAt(0) ?? 0);
    if (bytes > limit) return true;
  }
  return false;
}

function utf8ByteLength(text: string): number {
  let bytes = 0;
  for (const char of text) bytes += utf8Width(char.codePointAt(0) ?? 0);
  return bytes;
}

/**
 * The UTF-8 size of `next` when writing it must be refused, otherwise null.
 *
 * Content over the cap is refused only when it is also larger than the
 * `stored` body. Pages saved before the cap existed may be larger than it, and
 * an edit that shrinks one must always succeed, even while the result is still
 * over the cap, so its owner is never locked out. A create has no stored body:
 * anything over the cap is refused. Content under the cap costs one bounded
 * scan; `stored` is only measured, up to the new size, when `next` is over it.
 * `limit` is the cap (tests pass a small one to exercise the rule cheaply).
 */
export function oversizedPageContent(next: string, stored?: string, limit = MAX_PAGE_CONTENT_BYTES): number | null {
  if (!exceedsUtf8Bytes(next, limit)) return null;
  const bytes = utf8ByteLength(next);
  // `stored` holding at least as many bytes means this write does not grow it.
  if (stored !== undefined && exceedsUtf8Bytes(stored, bytes - 1)) return null;
  return bytes;
}
