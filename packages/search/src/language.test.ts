import { readFile } from 'node:fs/promises';
import { describe, expect, it } from 'vitest';
import { detectQuestionLanguage, questionLanguage } from './language';

describe('question language', () => {
  it.each([
    ['How do I add a new user?', 'ar', 'en'],
    ['كيف أضيف مستخدم جديد؟', 'fa', 'ar'],
    ['kifash nzid user jdid', 'en', 'ar'],
    ['Comment ajouter un nouvel utilisateur ?', 'en', 'fr'],
    ['¿Cómo puedo añadir un nuevo usuario?', 'ar', 'es'],
    ['چگونه می‌توانم یک کاربر جدید اضافه کنم؟', 'en', 'fa'],
    ['میں نیا صارف کیسے شامل کروں؟', 'en', 'ur'],
  ])('identifies %s on a %s reader without equating script and language', (text, reader, expected) => {
    expect(detectQuestionLanguage(text, reader, ['en', 'ar', 'fr', 'es', 'fa', 'ur'])).toMatchObject({
      language: expected,
      replyLanguage: expected,
      confident: true,
    });
    expect(questionLanguage(text, reader)).toBe(expected);
  });
  it('puts confidently unsupported languages in the other bucket instead of forcing a published language', () => {
    expect(detectQuestionLanguage('Comment ajouter un nouvel utilisateur ?', 'ar', ['en', 'ar'])).toMatchObject({
      language: 'other',
      replyLanguage: 'fr',
      confident: true,
    });
  });
  it.each(['How?', 'كيف؟', 'user', 'API_URL', '123?'])('keeps the reader prior when %s is ambiguous', (text) => {
    expect(detectQuestionLanguage(text, 'ar', ['en', 'ar'])).toMatchObject({ replyLanguage: 'ar', confident: false });
    expect(detectQuestionLanguage(text, 'en', ['en', 'ar'])).toMatchObject({ replyLanguage: 'en', confident: false });
  });
  it('keeps the detector behind the node-only search entry, separate from the browser Arabic analyzer', async () => {
    const manifest = JSON.parse(await readFile(new URL('../package.json', import.meta.url), 'utf8'));
    expect(manifest.dependencies.eld).toBe('2.1.0');
    expect(manifest.exports['.']).toMatchObject({ node: './dist/index.mjs' });
    expect(manifest.exports['.'].default).toBeUndefined();
    const clientAnalyzer = await readFile(new URL('./arabic.ts', import.meta.url), 'utf8');
    expect(clientAnalyzer).not.toMatch(/from\s+['"]eld/);
  });
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
