/**
 * Join links: a shareable link that lets anyone with it join one site.
 * Browser-safe rules shared by the API, the auth hooks and the dashboard.
 * Token generation and hashing (Node only) live in `./crypto`.
 */

/** Cookie the public /join page sets for a signed-out visitor, so the account
 *  created on the way back is not also given an unrelated starter workspace.
 *  It holds the token for one hour and is cleared once the visitor has joined. */
export const JOIN_LINK_COOKIE = 'nibleaf_join';
export const JOIN_LINK_COOKIE_MAX_AGE_SECONDS = 60 * 60;

/** `nlj_` + 43 base64url characters (32 random bytes, 256 bits). */
export const JOIN_LINK_TOKEN_PATTERN = /^nlj_[A-Za-z0-9_-]{43}$/;
export const isJoinLinkToken = (value: unknown): value is string => typeof value === 'string' && JOIN_LINK_TOKEN_PATTERN.test(value);

/** In-app path of a join link's public page. */
export const joinLinkPath = (token: string) => `/join/${token}`;

const DOMAIN_PATTERN = /^(?=.{1,253}$)(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$/;

/** `@Acme.com`, ` acme.com ` → `acme.com`; anything that is not a domain → null. */
export const normalizeEmailDomain = (value: string): string | null => {
  const domain = value.trim().toLowerCase().replace(/^@+/, '');
  return DOMAIN_PATTERN.test(domain) ? domain : null;
};

/** Whether `email` is at exactly `domain` (no subdomains: `x@evil.acme.com` is not `acme.com`). */
export const emailInDomain = (email: string, domain: string | null | undefined): boolean => {
  if (!domain) return true;
  const at = email.lastIndexOf('@');
  return (
    at > 0 &&
    email
      .slice(at + 1)
      .trim()
      .toLowerCase() === domain
  );
};

export type JoinLinkStatus = 'active' | 'revoked' | 'expired' | 'used_up';

/** A link's state at `now`. Only `active` links can be joined through. */
export const joinLinkStatus = (
  link: { revokedAt: Date | string | null; expiresAt: Date | string | null; maxUses: number | null; useCount: number },
  now: Date = new Date(),
): JoinLinkStatus => {
  if (link.revokedAt) return 'revoked';
  if (link.expiresAt && new Date(link.expiresAt).getTime() <= now.getTime()) return 'expired';
  if (link.maxUses !== null && link.useCount >= link.maxUses) return 'used_up';
  return 'active';
};
