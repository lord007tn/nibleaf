/**
 * Search limits shared by the public search API and the reader's browser-side
 * check. This module has no zod import, so the reader can use it without
 * pulling zod into the search dialog's chunks.
 */

/** Longest search query the public API accepts (`searchQuery.q`), in code
 *  points, the way zod's `.max()` counts string length. */
export const SEARCH_QUERY_MAX_LENGTH = 200;
