import { describe, expect, it } from 'vitest';
import { renderEmailVerificationEmail, renderNewSignInEmail, renderVerificationCodeEmail } from './index';

describe('localized transactional email rendering', () => {
  it('renders an English verification code with a plain-text body', async () => {
    const email = await renderVerificationCodeEmail({ code: '123456', purpose: 'sign-in' });

    expect(email.subject).toBe('Your Nibleaf sign-in code');
    expect(email.html).toContain('lang="en"');
    expect(email.html).toContain('123456');
    expect(email.text).toContain('123456');
  });

  it('renders Arabic email chrome with RTL direction', async () => {
    const email = await renderNewSignInEmail({ language: 'ar' });

    expect(email.subject).toBe('تسجيل دخول جديد إلى حسابك في نيبليف');
    expect(email.html).toContain('dir="rtl"');
    expect(email.html).toContain('lang="ar"');
    expect(email.text).toContain('رصدنا تسجيل دخول');
  });

  it('escapes a dynamic action URL in HTML while preserving it in text', async () => {
    const email = await renderEmailVerificationEmail({ url: 'https://example.com/verify?token=abc&next=<home>' });

    expect(email.html).toContain('token=abc&amp;next=&lt;home&gt;');
    expect(email.html).not.toContain('next=<home>');
    expect(email.text).toContain('https://example.com/verify?token=abc&next=<home>');
  });
});
