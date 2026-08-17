---
title: 'Protect documentation with private reader access'
description: 'Choose workspace or reader access, configure audiences and portal JWT handoff, and recover quickly from a compromised reader integration.'
audience: 'site administrators and customer-portal developers'
content_type: 'how-to'
last_reviewed: '2026-08-17'
verified_against: 'apps/server/src/actions/reader-access.ts and apps/server/src/lib/reader-jwt.ts'
---

Nibleaf has three explicit published-site access modes:

- `PUBLIC` is the default and preserves existing public sites.
- `WORKSPACE` requires a Nibleaf workspace member. Existing sites with `config.visibility = private` are migrated to this mode automatically.
- `READERS` uses dedicated reader identities. Readers cannot open the dashboard, edit content, or consume an author seat.

Administrators configure the mode under **Site settings → Authentication**. The same screen manages audiences, page grants, invitations, JWT handoff, audit events, and emergency revocation.

## Invitations and sessions

An administrator assigns at least one audience and sends an invitation. The email contains a random, single-use activation token that expires after seven days. Only a SHA-256 hash is stored. Activation creates a host-only, `HttpOnly`, `SameSite=Lax` reader cookie; HTTPS deployments also set `Secure`. Session tokens are hashed and can be revoked independently or all at once.

Use the primary custom domain before inviting readers. Nibleaf creates the activation link on that domain so its host-only cookie belongs to the customer docs origin. Re-inviting invalidates unused invitations. Revoking a reader invalidates invitations and every active session immediately.

Audience grants can cover the entire site or selected pages. Page-scoped readers receive only granted pages plus navigation ancestors, and server-side search uses the same filtered set. Assets are authorized at the owning-site boundary because the current asset model does not associate an upload with one page.

## Customer portal JWT handoff

Configure an exact issuer URL (`iss`), audience (`aud`), either an HTTPS JWKS URL or an inline **public** JWKS, and a mapping from group claim values to Nibleaf audience IDs. Never paste private keys or symmetric secrets.

Send a signed assertion to:

```http
POST /api/public/reader-access/jwt/{projectId}
Content-Type: application/json

{"token":"eyJ...","redirect":"/guides/getting-started"}
```

The response sets the reader cookie. Redirects must be same-origin paths. Assertions must use `RS256`, `PS256`, `ES256`, or `EdDSA` and contain:

- exact `iss` and matching `aud`
- stable `sub`
- `iat` and `exp` within the configured age and clock tolerance
- unique, single-use `jti`
- the configured groups claim, mapped to one or more audiences

Optional `email` and `name` claims populate the reader profile. Nested paths such as `profile.groups` are supported. A used `jti` is stored as an issuer-bound hash until expiry and cannot be replayed. Tokens and signing material are never written to audit logs.

### Key rotation

Publish old and new public keys together with distinct `kid` values, begin signing with the new key, wait longer than the maximum assertion lifetime plus JWKS cache time, then remove the old key. Use **Test JWT** before switching traffic; testing verifies an assertion without creating a session or consuming its `jti`.

### Recovery and emergency revocation

If a portal key or mapping may be compromised:

1. Select **Emergency revoke all access** to revoke sessions and invitations and disable JWT handoff.
2. Rotate the portal signing key and publish the new public JWKS.
3. Review the Authentication audit log and correct issuer/audience/mapping settings.
4. Test a fresh assertion, re-enable handoff, and re-invite non-SSO readers as needed.

## Delivery and caching guarantees

The access decision is made server-side for site/page payloads, navigation, search, changelog, sitemap, robots, `llms.txt`, `llms-full.txt`, analytics writes, and stored assets. Unauthenticated private requests return not-found responses. Credential-dependent responses use `Cache-Control: private, no-store` and `Vary: Cookie, Authorization`; SSR forwards only reader credentials to internal API fetches. Draft previews remain workspace-member-only.
