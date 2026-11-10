import { describe, expect, it } from 'vitest';
import {
  renderEmailVerificationEmail,
  renderMemberInvitationEmail,
  renderNewSignInEmail,
  renderReaderInvitationEmail,
  renderSiteSignInCodeEmail,
  renderVerificationCodeEmail,
} from './index';

describe('localized transactional email rendering', () => {
  it('sends a private site sign-in code in the site name, in Arabic too', async () => {
    const english = await renderSiteSignInCodeEmail({ code: '482913', projectName: 'Acme Docs' });
    expect(english.subject).toBe('Your sign-in code for Acme Docs');
    expect(english.text).toContain('482913');
    expect(english.text).toContain('Acme Docs');
    const arabic = await renderSiteSignInCodeEmail({ code: '482913', projectName: 'Acme Docs', language: 'ar' });
    expect(arabic.subject).toBe('رمز تسجيل الدخول إلى Acme Docs');
    expect(arabic.html).toContain('dir="rtl"');
  });

  it('tells an invited reader how to get back in after the invitation link is used', async () => {
    const email = await renderReaderInvitationEmail({ activationUrl: 'https://docs.example.com/x', days: 7, projectName: 'Acme Docs' });
    expect(email.text).toContain('sign in with this email address');
  });

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
  it('describes organization membership and all website grants in both email forms', async () => {
    const email = await renderMemberInvitationEmail({
      acceptUrl: 'https://app.example.com/accept-invite/abc',
      days: 7,
      inviterName: 'Ada',
      organizationName: 'Synthetic Org',
      role: 'member',
      organizationRole: true,
      grants: [
        { name: 'Docs <private>', role: 'viewer' },
        { name: 'API', role: 'admin' },
      ],
    });
    expect(email.text).toContain('as Member');
    expect(email.text).toContain('Docs <private> (Viewer)');
    expect(email.text).toContain('API (Admin)');
    expect(email.html).toContain('Docs &lt;private&gt;');
    expect(email.html).toContain('API (Admin)');
  });
});
