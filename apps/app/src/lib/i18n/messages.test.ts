import { describe, expect, it } from 'vitest';
import bengali from './catalogs/bn.json';
import german from './catalogs/de.json';
import spanish from './catalogs/es.json';
import french from './catalogs/fr.json';
import hindi from './catalogs/hi.json';
import indonesian from './catalogs/id.json';
import brazilianPortuguese from './catalogs/pt-BR.json';
import russian from './catalogs/ru.json';
import urdu from './catalogs/ur.json';
import simplifiedChinese from './catalogs/zh-CN.json';
import { messages } from './messages';

const catalogs = {
  ...messages,
  'zh-CN': simplifiedChinese,
  hi: hindi,
  es: spanish,
  fr: french,
  bn: bengali,
  'pt-BR': brazilianPortuguese,
  ru: russian,
  ur: urdu,
  id: indonesian,
  de: german,
};

const placeholders = (value: string) => [...value.matchAll(/\{([A-Za-z0-9_]+)\}/g)].map((match) => match[1]).sort();

describe('i18n message tables', () => {
  it('keeps en and ar key sets identical (lock-step)', () => {
    const missingInAr = Object.keys(messages.en).filter((key) => !(key in messages.ar));
    const extraInAr = Object.keys(messages.ar).filter((key) => !(key in messages.en));
    expect(missingInAr).toEqual([]);
    expect(extraInAr).toEqual([]);
  });

  it('keeps every shipped locale key-complete and non-empty', () => {
    const englishKeys = Object.keys(messages.en).sort();
    for (const [locale, table] of Object.entries(catalogs)) {
      expect(Object.keys(table).sort(), `${locale} key set`).toEqual(englishKeys);
      for (const [key, value] of Object.entries(table)) {
        expect(value, `${locale}.${key} should be non-empty`).not.toBe('');
        expect(placeholders(value), `${locale}.${key} placeholders`).toEqual(placeholders(messages.en[key as keyof typeof messages.en]));
      }
    }
  });

  it('contains translated copy instead of an English fallback catalog', () => {
    for (const [locale, table] of Object.entries(catalogs).filter(([locale]) => locale !== 'en')) {
      const translated = Object.entries(table).filter(([key, value]) => value !== messages.en[key as keyof typeof messages.en]).length;
      expect(translated / Object.keys(messages.en).length, `${locale} translated ratio`).toBeGreaterThan(0.8);
    }
  });

  it('uses goal-based labels for passwordless authentication', () => {
    expect(messages.en['auth.otp.sendSignIn']).toBe('Log in');
    expect(messages.en['auth.otp.verifySignIn']).toBe('Log in');
    expect(messages.en['auth.otp.sendCreate']).toBe('Create account');
    expect(messages.en['auth.otp.verifyCreate']).toBe('Create account');
    expect(messages.en['auth.google.signIn']).toBe('Log in with Google');
    expect(messages.en['auth.google.signUp']).toBe('Create account with Google');
    expect(messages.en['auth.otp.resend']).toBe('Resend code');

    expect(messages.ar['auth.otp.sendSignIn']).toBe('تسجيل الدخول');
    expect(messages.ar['auth.otp.sendCreate']).toBe('إنشاء حساب');
    expect(messages.ar['auth.otp.resend']).toBe('إعادة إرسال الرمز');
  });
});
