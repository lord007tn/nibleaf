---
title: 'Make your docs private'
description: 'Limit who can read your published docs, invite readers into audiences, sign readers in from your own portal, and revoke access quickly.'
audience: 'site admins and customer-portal developers'
content_type: 'how-to'
last_reviewed: '2026-11-07'
verified_against: 'apps/app/src/components/project-settings/authentication-section.tsx, apps/server/src/actions/reader-access.ts, apps/server/src/lib/reader-jwt.ts, and packages/i18n/messages'
lang: 'en'
dir: 'ltr'
translation_key: 'private-reader-access'
---

By default, anyone can read your published docs. You can instead limit them to
your team or to readers you choose, such as customers. Open
**Settings → Authentication**. You need to be the site's Owner or an Admin.

## Choose who can read

Under **Access mode**, choose one option and select **Save access mode**:

- **Public:** anyone can read the site. This is the default.
- **Workspace members:** only people on the site's team can read it. They sign in
  with their Nibleaf account.
- **Private readers:** only readers you invite or sign in from your own portal
  can read it. Readers can't open the dashboard or edit anything, and they don't
  count as team members.

Unpublished draft previews are always limited to the site's team, whatever mode
you choose.

## Invite private readers

Choose **Private readers** first. Until you save that mode, the reader controls
show **Reader controls are inactive**.

1. **Create an audience.** Under **Audiences and content rules**, name a group of
   readers, such as "Customers", and select **Create audience**. Leave every page
   unselected to give the audience the **Entire site**, or select only the pages
   it may read.
2. **Invite readers.** Under **Dedicated readers**, enter an email address and an
   optional **Name (optional)**, pick at least one audience, and select
   **Invite reader**. Nibleaf emails the invitation and also shows a link you can
   copy and share.
3. The reader opens the link to activate access. Invitations work once and
   expire after 7 days. Inviting someone again cancels their unused invitations.

Connect your [custom domain](/product/custom-domains) before you invite readers.
Invitation links use your primary domain, so readers stay signed in on your
docs address.

Readers limited to some pages see only those pages, plus the groups that contain
them, in navigation and search.

To remove a reader, select **Revoke**. Their invitations and sessions stop
working straight away.

## Sign readers in from your own portal

If your customers already sign in to your product, your developers can send them
to the docs without a separate invitation. This uses a JWT, a short signed
message from your system that says who the reader is and which groups they
belong to.

Select **Configure JWT handoff** and fill in:

- the exact issuer (`iss`) and audience (`aud`) your system puts in the token;
- your public signing keys, as an HTTPS JWKS address or a pasted public JWKS.
  Never paste a private key or shared secret;
- how values in your groups claim map to Nibleaf audiences.

Select **Save JWT configuration**, paste a signed sample token into **Test JWT**
to check it without signing anyone in, then select **Enable JWT handoff**.

Your portal then posts the token to Nibleaf:

```http
POST /api/public/reader-access/jwt/{projectId}
Content-Type: application/json

{"token":"eyJ...","redirect":"/guides/getting-started"}
```

Nibleaf signs the reader in and sends them to the `redirect` path on the same
site. The token must:

- be signed with `RS256`, `PS256`, `ES256`, or `EdDSA`;
- contain the exact `iss`, a matching `aud`, and a stable `sub` for the reader;
- contain `iat` and `exp` within the allowed age;
- contain a unique `jti`, which can be used only once;
- contain the groups claim you mapped. It can be nested, such as `profile.groups`.

Optional `email` and `name` claims fill in the reader's profile. Nibleaf never
stores tokens or keys in its activity log.

To change signing keys safely, publish the old and new public keys together with
different `kid` values, start signing with the new key, wait longer than a token
lives, then remove the old key.

## Respond to a security problem

If a portal key or reader may be compromised:

1. Select **Emergency revoke all access**. This signs out every reader, cancels
   all invitations, and turns off JWT handoff.
2. Replace your portal's signing key and publish the new public keys.
3. Select **Review security activity** under **Audit and emergency revocation**,
   and correct any wrong settings.
4. Test a new token, turn JWT handoff back on, and invite readers again where
   needed.

## What stays private

When a site is private, Nibleaf checks access on the server for every page,
search, the sitemap, `llms.txt`, analytics, and uploaded files. Signed-out
visitors get a "not found" response, and private pages are never stored in shared
caches. Uploaded files are protected per site, not per page, so a reader with
access to any page can open files linked from the site.
