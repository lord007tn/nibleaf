import { describe, expect, it } from 'vitest';
import { renderEmailVerificationEmail, renderMemberInvitationEmail, renderNewSignInEmail, renderVerificationCodeEmail } from './index';

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

  it.each([
    ['en', 'viewer', 'as Viewer'],
    ['en', 'member', 'as Editor'],
    ['ar', 'viewer', 'بصفتك مشاهد'],
    ['ar', 'admin', 'بصفتك مشرف'],
  ] as const)('names the invited role in the reader language (%s, %s)', async (language, role, phrase) => {
    const email = await renderMemberInvitationEmail({
      acceptUrl: 'https://app.example.com/accept-invite/abc',
      days: 7,
      inviterName: 'Ada',
      language,
      organizationName: 'Acme Docs',
      role,
    });
    expect(email.text).toContain(phrase);
    expect(email.text).not.toMatch(/\b(viewer|member)\b/);
  });
});
