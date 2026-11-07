/** The base language of a code: `ar-SA` → `ar`. */
const baseLanguage = (code: string): string => code.toLowerCase().split(/[-_]/)[0] ?? '';

/**
 * Reader search results in the reader's language first, then the other
 * languages, each keeping the server's order. Each language is scored in its
 * own index, so a match inside an Arabic code span can outscore the exact
 * English title it was translated from; the reader's own language must win.
 */
export const readerLanguageFirst = <Hit extends { language: string }>(hits: readonly Hit[], readerLanguage?: string): Hit[] => {
  if (!readerLanguage) return [...hits];
  const reader = baseLanguage(readerLanguage);
  return [...hits.filter((hit) => baseLanguage(hit.language) === reader), ...hits.filter((hit) => baseLanguage(hit.language) !== reader)];
};
