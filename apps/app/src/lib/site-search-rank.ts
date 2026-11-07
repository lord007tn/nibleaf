/**
 * Reader search results in the reader's language first, then the other
 * languages, each keeping the server's order. Each language is scored in its
 * own index, so a match inside an Arabic code span can outscore the exact
 * English title it was translated from; the reader's own language must win.
 *
 * Both codes are the site's own language codes, so they match exactly: a
 * `pt-BR` reader does not count `pt-PT` results as their own.
 */
export const readerLanguageFirst = <Hit extends { language: string }>(hits: readonly Hit[], readerLanguage?: string): Hit[] => {
  if (!readerLanguage) return [...hits];
  return [...hits.filter((hit) => hit.language === readerLanguage), ...hits.filter((hit) => hit.language !== readerLanguage)];
};
