import { describe, expect, it } from 'vitest';
import { resolveEmailDelivery } from './email-delivery';

describe('resolveEmailDelivery', () => {
  it('prefers Postmark when both providers are configured', () => {
    expect(resolveEmailDelivery({ postmarkApiKey: 'server-token', smtpUrl: 'smtp://localhost', required: true })).toEqual({
      provider: 'postmark',
      ready: true,
      required: true,
    });
  });

  it('uses SMTP when Postmark is not configured', () => {
    expect(resolveEmailDelivery({ smtpUrl: 'smtp://localhost', required: true })).toEqual({
      provider: 'smtp',
      ready: true,
      required: true,
    });
  });

  it('reports a required provider as unavailable', () => {
    expect(resolveEmailDelivery({ postmarkApiKey: ' ', smtpUrl: '', required: true })).toEqual({
      provider: null,
      ready: false,
      required: true,
    });
  });

  it('allows provider-free local development when delivery is optional', () => {
    expect(resolveEmailDelivery({ required: false })).toEqual({
      provider: null,
      ready: true,
      required: false,
    });
  });
});
