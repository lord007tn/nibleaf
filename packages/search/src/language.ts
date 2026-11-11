/** The question wins over the reader locale. Arabic prose may contain English
 * UI labels; a question without letters keeps the reader's language. */
export const questionLanguage = (question: string, readerLanguage: string): string => {
  const arabic = question.match(/(?=\p{L})\p{Script=Arabic}/gu)?.length ?? 0;
  const latin = question.match(/\p{Script=Latin}/gu)?.length ?? 0;
  const prior = readerLanguage.toLowerCase().split('-')[0] ?? 'en';
  if (arabic > 0 && arabic * 4 >= latin) return ['fa', 'ur', 'ps', 'sd', 'ckb', 'ug'].includes(prior) ? prior : 'ar';
  if (latin > 0 && (prior === 'ar' || prior === 'en')) return 'en';
  return prior;
};
