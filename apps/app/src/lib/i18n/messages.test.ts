import { describe, expect, it } from 'vitest';
import { messages } from './messages';

describe('i18n message tables', () => {
  it('keeps en and ar key sets identical (lock-step)', () => {
    const missingInAr = Object.keys(messages.en).filter((key) => !(key in messages.ar));
    const extraInAr = Object.keys(messages.ar).filter((key) => !(key in messages.en));
    expect(missingInAr).toEqual([]);
    expect(extraInAr).toEqual([]);
  });

  it('has no empty values in either locale', () => {
    for (const [locale, table] of Object.entries(messages)) {
      for (const [key, value] of Object.entries(table)) {
        expect(value, `${locale}.${key} should be non-empty`).not.toBe('');
      }
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
