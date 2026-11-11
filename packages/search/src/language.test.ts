import { describe, expect, it } from 'vitest';
import { questionLanguage } from './language';

describe('question language', () => {
  it.each([
    ['كيف أضيف مستخدمًا جديدًا؟', 'en', 'ar'],
    ['كيف أضيف user جديد؟', 'en-US', 'ar'],
    ['How do I add a new user?', 'ar', 'en'],
    ['كيف؟', 'ar-SA', 'ar'],
    ['123?', 'ar-SA', 'ar'],
    ['١٢٣?', 'en', 'en'],
    ['?', 'en', 'en'],
    ['Comment ajouter un utilisateur ?', 'fr', 'fr'],
  ])('%s with reader language %s uses %s', (query, prior, expected) => {
    expect(questionLanguage(query, prior)).toBe(expected);
  });
});
