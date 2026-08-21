import { describe, expect, it } from 'vitest';
import { buildPasswordResetEmail, buildTransactionalEmail } from './transactional-email';

describe('buildTransactionalEmail', () => {
  it('renders a branded HTML action and plain-text fallback', async () => {
    const email = await buildTransactionalEmail({
      subject: ' Reset your password ',
      preheader: 'Reset access',
      title: 'Choose a new password',
      message: 'Use this secure link within one hour.',
      action: { label: 'Reset password', url: 'https://example.com/reset?token=abc' },
      detail: 'The link expires in one hour.',
    });

    expect(email.subject).toBe('Reset your password');
    expect(email.html).toContain('Nibleaf');
    expect(email.html).toContain('Reset password');
    expect(email.html).toContain('https://example.com/reset?token=abc');
    expect(email.text).toContain('Reset password: https://example.com/reset?token=abc');
    expect(email.text).toContain('The link expires in one hour.');
  });

  it('escapes dynamic values in HTML while preserving readable plain text', async () => {
    const email = await buildTransactionalEmail({
      subject: 'Security alert',
      preheader: 'A <new> sign-in',
      title: 'Hello <script>',
      message: 'Account <owner> signed in.',
      code: '<123456>',
    });

    expect(email.html).not.toContain('<script>');
    expect(email.html).toContain('Hello &lt;script&gt;');
    expect(email.html).toContain('&lt;123456&gt;');
    expect(email.text).toContain('Code: <123456>');
  });

  it('keeps the subject on one line', async () => {
    const email = await buildTransactionalEmail({
      subject: 'Security alert\r\nInjected header',
      preheader: 'Security alert',
      title: 'Security alert',
      message: 'Review your account.',
    });

    expect(email.subject).toBe('Security alert Injected header');
  });

  it('uses escaped fallback HTML when the React Email renderer rejects', async () => {
    const email = await buildTransactionalEmail(
      {
        subject: 'Reset access',
        preheader: 'Reset <access>',
        title: 'Choose a <password>',
        message: 'Use the secure link.',
        action: { label: 'Reset now', url: 'https://example.com/reset?token=abc&next=<home>' },
        detail: 'Expires soon.',
      },
      async () => {
        throw new Error('renderer unavailable');
      },
    );

    expect(email.html).toContain('<!doctype html>');
    expect(email.html).toContain('Choose a &lt;password&gt;');
    expect(email.html).toContain('token=abc&amp;next=&lt;home&gt;');
    expect(email.html).not.toContain('<password>');
    expect(email.text).toContain('Reset now: https://example.com/reset?token=abc&next=<home>');
  });

  it('uses the Better Auth reset callback URL unchanged', async () => {
    const resetUrl = 'https://nibleaf.com/api/auth/reset-password/test-token?callbackURL=https%3A%2F%2Fnibleaf.com%2Freset-password';
    const email = await buildPasswordResetEmail(resetUrl);

    expect(email.subject).toBe('Reset your Nibleaf password');
    expect(email.html).toContain('Choose a new password');
    expect(email.html).toContain(resetUrl.replaceAll('&', '&amp;'));
    expect(email.text).toContain(`Choose a new password: ${resetUrl}`);
    expect(email.text).toContain('single-use link expires in one hour');
  });
});
