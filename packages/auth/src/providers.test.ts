import { describe, expect, it } from 'vitest';
import { googleOAuthEnabled } from './providers';

describe('googleOAuthEnabled', () => {
  it('enables Google only when both credentials are non-blank after trimming', () => {
    expect(googleOAuthEnabled({ GOOGLE_CLIENT_ID: 'client', GOOGLE_CLIENT_SECRET: 'secret' })).toBe(true);
    expect(googleOAuthEnabled({ GOOGLE_CLIENT_ID: 'client' })).toBe(false);
    expect(googleOAuthEnabled({ GOOGLE_CLIENT_SECRET: 'secret' })).toBe(false);
    expect(googleOAuthEnabled({ GOOGLE_CLIENT_ID: ' ', GOOGLE_CLIENT_SECRET: 'secret' })).toBe(false);
    expect(googleOAuthEnabled({ GOOGLE_CLIENT_ID: 'client', GOOGLE_CLIENT_SECRET: ' ' })).toBe(false);
  });
});
