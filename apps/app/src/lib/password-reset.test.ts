import { describe, expect, it } from 'vitest';
import { passwordsMatch, resetLinkIsInvalid } from './password-reset';

describe('password reset state', () => {
  it('requires the password confirmation to match', () => {
    expect(passwordsMatch('correct horse', 'correct horse')).toBe(true);
    expect(passwordsMatch('correct horse', 'wrong battery')).toBe(false);
  });

  it('rejects missing, callback-rejected, and consumed reset links', () => {
    expect(resetLinkIsInvalid('', '', false)).toBe(true);
    expect(resetLinkIsInvalid('token', 'INVALID_TOKEN', false)).toBe(true);
    expect(resetLinkIsInvalid('token', '', true)).toBe(true);
    expect(resetLinkIsInvalid('token', '', false)).toBe(false);
  });
});
