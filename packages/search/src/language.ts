import { eld } from 'eld/medium';

// An isolated detector avoids mutable language subsets shared between sites.
const detector = eld.newInstance();
const baseLanguage = (language: string) => language.toLowerCase().split(/[-_]/)[0] ?? 'en';

/** Classify among published languages plus an explicit other bucket. Keeping
 * the full detector population prevents an unsupported language being forced
 * into the nearest published one. Short/uncertain inputs keep the reader prior. */
export const detectQuestionLanguage = (question: string, readerLanguage: string, publishedLanguages: readonly string[] = [readerLanguage]) => {
  const prior = baseLanguage(readerLanguage);
  const text = question.slice(0, 2000);
  const result = detector.detect(text);
  const arabizi = !result.isReliable() && new Set(text.toLowerCase().match(/\b(?:kifash|kifach|nzid|jdid|jdida)\b/g) ?? []).size >= 2;
  const confident = arabizi || result.isReliable();
  const replyLanguage = arabizi ? 'ar' : confident && result.language ? result.language : prior;
  const published = publishedLanguages.some((language) => baseLanguage(language) === replyLanguage);
  return { language: published ? replyLanguage : 'other', replyLanguage, confident };
};

export const questionLanguage = (question: string, readerLanguage: string, publishedLanguages?: readonly string[]): string =>
  detectQuestionLanguage(question, readerLanguage, publishedLanguages).replyLanguage;
