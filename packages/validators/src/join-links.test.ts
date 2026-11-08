import { describe, expect, it } from 'vitest';
import { createJoinLinkBody } from './index';

describe('createJoinLinkBody', () => {
  it('defaults to an Editor link with no limits', () => {
    expect(createJoinLinkBody.parse({})).toEqual({ role: 'member' });
  });

  it('normalizes the domain and keeps the limits', () => {
    expect(createJoinLinkBody.parse({ role: 'viewer', allowedDomain: ' @Acme.com ', maxUses: 5, expiresInDays: 7, label: ' Support ' })).toEqual({
      role: 'viewer',
      allowedDomain: 'acme.com',
      maxUses: 5,
      expiresInDays: 7,
      label: 'Support',
    });
    expect(createJoinLinkBody.parse({ allowedDomain: '' }).allowedDomain).toBeUndefined();
  });

  it.each([
    { role: 'owner' },
    { allowedDomain: 'not a domain' },
    { maxUses: 0 },
    { maxUses: 1.5 },
    { expiresInDays: 0 },
    { expiresInDays: 366 },
    { label: 'x'.repeat(61) },
    { token: 'nlj_injected' },
  ])('rejects %j', (body) => {
    expect(createJoinLinkBody.safeParse(body).success).toBe(false);
  });
});
