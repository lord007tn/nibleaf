import { describe, expect, it } from 'vitest';
import { isPublicEmailProvider } from './email-providers';

describe('public email providers', () => {
  it.each([
    'gmail.com',
    'outlook.com',
    'hotmail.com',
    'yahoo.com',
    'icloud.com',
    'proton.me',
    'protonmail.com',
    'aol.com',
    'gmx.de',
    'gmx.net',
    'mail.ru',
    'yandex.ru',
    'yandex.com.tr',
    'qq.com',
    '163.com',
    'yahoo.co.uk',
    'hotmail.fr',
    'outlook.com.br',
    'live.co.za',
  ])('recognises %s', (domain) => {
    expect(isPublicEmailProvider(domain)).toBe(true);
  });

  it('ignores case, a leading @ and a trailing dot', () => {
    expect(isPublicEmailProvider(' @Gmail.COM. ')).toBe(true);
  });

  it.each([
    'acme.com',
    'example.org',
    'partner.example',
    // A company's own subdomain that happens to start with a provider's name.
    'outlook.acme.com',
    'mail.acme.com',
    'yahoo.acme.co.uk',
    // A company domain that merely contains a provider's name.
    'gmailtools.com',
    'acme-gmail.com',
  ])('accepts the company domain %s', (domain) => {
    expect(isPublicEmailProvider(domain)).toBe(false);
  });
});
